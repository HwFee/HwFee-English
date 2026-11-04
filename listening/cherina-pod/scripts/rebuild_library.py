#!/usr/bin/env python3
"""Rebuild the existing library as one Android import pack; keep original materials intact.

Use --plan to prepare bilingual splits, then fill episodes/rebuild-translations.json.
Word alignment comes from align_audio.py. Old segment numbers remain stable.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import zipfile
from pathlib import Path

import build_lesson as build
from sentence_chunks import MAX_WORDS, MAX_CHARS, split_source

ROOT = Path(__file__).resolve().parent.parent
REVISION = '2026-11-04'


def payload(path):
    return json.loads(re.search(r'<script\b[^>]*\bid="data"[^>]*>(.*?)</script>', path.read_text('utf-8'), re.S)[1])


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), 'utf-8')


def lesson_plans():
    plans = []
    for folder in sorted((ROOT / 'lessons' / 'cet6').iterdir()):
        if not folder.is_dir():
            continue
        old = payload(folder / 'player.html')
        for index, sentence in enumerate(old['sentences']):
            splits = split_source(sentence, [note for note in old['notes'] if note['n'] == sentence['n']])
            if len(splits) > 1:
                plans.append({'id': folder.name, 'n': index + 1, 'source': sentence['s'], 'target': sentence['t'],
                              'sources': [text for text, _, _ in splits]})
    return plans


def timed_tokens(sentence, raw_words, alignment):
    selected = [(i, word) for i, word in enumerate(raw_words)
                if sentence['a'] - .01 <= word['start'] < sentence['b'] - .005]
    records = []
    for index, word in selected:
        aligned = alignment[index]
        sound_start = aligned['start'] if aligned['score'] >= .2 else word['start']
        sound_end = aligned['end'] if aligned['score'] >= .2 else word['end']
        text_parts = word['word'].split()
        for part, text in enumerate(text_parts):
            records.append({'word': text, 'start': sound_start + (sound_end - sound_start) * part / len(text_parts),
                            'end': sound_start + (sound_end - sound_start) * (part + 1) / len(text_parts),
                            'score': aligned['score']})
    tokens = sentence['s'].split()
    if len(records) != len(tokens):
        starts = sentence.get('w') or []
        if len(starts) != len(tokens):
            raise ValueError('Missing word times: ' + sentence['s'])
        records = [{'word': token, 'start': starts[i], 'end': starts[i + 1] if i + 1 < len(tokens) else sentence['b'], 'score': 0}
                   for i, token in enumerate(tokens)]
    return records


def rebuild_one(folder, translations, covers):
    old = payload(folder / 'player.html')
    episode = ROOT / 'episodes' / folder.name
    transcript = json.loads((episode / 'transcript.json').read_text('utf-8'))
    alignment = json.loads((episode / 'alignment.json').read_text('utf-8'))
    if not alignment.get('complete'):
        raise ValueError('Audio alignment incomplete: ' + folder.name)
    sentences, remap, diagnostics = [], {}, []
    for index, original in enumerate(old['sentences']):
        remap[index] = len(sentences)
        splits = split_source(original, [note for note in old['notes'] if note['n'] == original['n']])
        targets = translations.get(folder.name + ':' + str(index + 1)) if len(splits) > 1 else [original['t']]
        if not targets or len(targets) != len(splits) or not all(isinstance(t, str) and t.strip() for t in targets):
            raise ValueError('Missing split translations: ' + folder.name + ':' + str(index + 1))
        times = timed_tokens(original, transcript['words'], alignment['words'])
        for (text, a, b), target in zip(splits, targets):
            first, last = times[a], times[b - 1]
            start = max(0, first['start'] - .06)
            end = max(start + .08, last['end'] + .10)
            if b < len(times):
                end = min(end, max(start + .08, times[b]['start'] - .06))
            sentences.append({'n': len(sentences) + 1, 's': text, 't': target.strip(),
                              'a': round(start, 3), 'b': round(end, 3),
                              'w': [round(max(start, min(end, word['start'])), 3) for word in times[a:b]],
                              'legacy_n': index + 1})
            if min(first['score'], last['score']) < .2:
                diagnostics.append({'n': len(sentences), 'reason': 'low-confidence audio edge'})
    remap[len(old['sentences'])] = len(sentences)
    for previous, following in zip(sentences, sentences[1:]):
        if previous['b'] > following['a']:
            seam = round(max(previous['a'] + .04, min(following['b'] - .04, (previous['b'] + following['a']) / 2)), 3)
            previous['b'], following['a'] = seam, seam
        previous['w'] = [max(previous['a'], min(previous['b'], value)) for value in previous['w']]
    for sentence in sentences:
        last_time = sentence['a']
        for index, value in enumerate(sentence['w']):
            last_time = max(last_time, min(sentence['b'], value))
            sentence['w'][index] = last_time
    segments = [{**group, 'from': remap[group['from']], 'to': remap[group['to']],
                 'start': sentences[remap[group['from']]]['a'], 'end': sentences[remap[group['to']] - 1]['b']}
                for group in old['segments']]
    notes, seen = [], set()
    # One set of expressions, retaining the advanced and everyday entries together.
    for name in ['notes-6.json', 'notes-4.json']:
        path = episode / name
        if not path.exists():
            continue
        for note in json.loads(path.read_text('utf-8')):
            key = note['expr'].lower()
            if key in seen:
                continue
            hit = next((sentence for sentence in sentences if key in sentence['s'].lower()), None)
            if hit:
                notes.append({**note, 'n': hit['n'], 'src': hit['s']})
                seen.add(key)
    lesson = {**old, 'sentences': sentences, 'audio': 'audio/episode.mp4', 'image': 'images/cover.jpg',
              'hwfeeCourse': {'schema': 2, 'id': folder.name,
                              'revision': '2-' + hashlib.sha256(json.dumps(sentences, ensure_ascii=False).encode()).hexdigest()[:12],
                              'legacyIds': ['cet6-' + folder.name, 'cet4-' + folder.name, folder.name],
                              'legacyTimeline': {'sentences': [{'a': s['a'], 'b': s['b']} for s in old['sentences']],
                                                 'segments': old['segments']}}}
    lesson.pop('segments', None)
    lesson.pop('notes', None)
    dest = ROOT / 'lessons' / 'unified' / folder.name
    (dest / 'audio').mkdir(parents=True, exist_ok=True)
    (dest / 'images').mkdir(exist_ok=True)
    audio = dest / 'audio' / 'episode.mp4'
    if not audio.exists():
        try:
            os.link(episode / 'audio' / 'episode.mp4', audio)
        except OSError:
            shutil.copy2(episode / 'audio' / 'episode.mp4', audio)
    cover = next((name for name in covers.namelist() if '/' + folder.name + '/images/cover.' in name), None)
    if not cover:
        raise ValueError('Missing offline cover: ' + folder.name)
    (dest / 'images' / 'cover.jpg').write_bytes(covers.read(cover))
    build.write_player(dest, lesson, segments, notes)
    build.write_handout(dest, lesson, segments, notes)
    build.write_notes_md(dest, lesson, notes)
    build.write_meta(dest, lesson, segments, notes)
    return {'id': folder.name, 'before': len(old['sentences']), 'after': len(sentences),
            'segments': len(segments), 'notes': len(notes), 'review': diagnostics}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--package', action='store_true', help='Also create the import ZIP after the course files are ready')
    args = parser.parse_args()
    plans = lesson_plans()
    if args.plan:
        write_json(ROOT / 'episodes' / 'rebuild-plan.json', plans)
        print(json.dumps({'sentences_to_split': len(plans), 'new_fragments': sum(len(plan['sources']) for plan in plans)}, ensure_ascii=False))
        return
    translations = json.loads((ROOT / 'episodes' / 'rebuild-translations.json').read_text('utf-8'))
    covered = next((ROOT / 'dist').rglob('*含封面.zip'))
    with zipfile.ZipFile(covered) as covers:
        reports = [rebuild_one(folder, translations, covers) for folder in sorted((ROOT / 'lessons' / 'cet6').iterdir()) if folder.is_dir()]
    build.write_index(ROOT / 'lessons' / 'unified')
    output = None
    if args.package:
        output = ROOT.parent.parent / 'dist' / ('HwFee-English-精听39节-修订版-' + REVISION + '.zip')
        output.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted((ROOT / 'lessons' / 'unified').rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT / 'lessons').as_posix())
    report = {'archive': str(output) if output else None, 'courses': len(reports), 'sentences': sum(row['after'] for row in reports), 'lessons': reports}
    write_json(ROOT.parent / 'archive' / 'rebuild-report.json', report)
    print(json.dumps({key: value for key, value in report.items() if key != 'lessons'}, ensure_ascii=False))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Check all rebuilt courses against the original text, timeline, and offline assets."""
import json
import zipfile
from pathlib import Path
from rebuild_library import ROOT, MAX_CHARS, MAX_WORDS, payload


def main():
    failures, courses, sentences, lengths = [], 0, 0, []
    for folder in sorted((ROOT / 'lessons' / 'unified').iterdir()):
        if not folder.is_dir():
            continue
        data = payload(folder / 'player.html')
        old = payload(ROOT / 'lessons' / 'cet6' / folder.name / 'player.html')
        courses += 1
        sentences += len(data['sentences'])
        if len(data['segments']) != len(old['segments']):
            failures.append(folder.name + ': segment count changed')
        for index, previous in enumerate(old['sentences'], 1):
            chunks = [row for row in data['sentences'] if row['legacy_n'] == index]
            if ' '.join(row['s'] for row in chunks) != previous['s']:
                failures.append(folder.name + ': source changed at ' + str(index))
        for i, sentence in enumerate(data['sentences']):
            prefix = folder.name + ':' + str(i + 1)
            lengths.append((len(sentence['s'].split()), len(sentence['s']), len(sentence['t'])))
            if len(sentence['s'].split()) > MAX_WORDS or len(sentence['s']) > MAX_CHARS or not sentence['t'].strip():
                failures.append(prefix + ': invalid bilingual length')
            if not (0 <= sentence['a'] < sentence['b'] <= data['duration'] + .1):
                failures.append(prefix + ': invalid sentence times')
            if len(sentence['w']) != len(sentence['s'].split()) or sentence['w'] != sorted(sentence['w']):
                failures.append(prefix + ': invalid word highlight times')
            if any(not sentence['a'] <= time <= sentence['b'] for time in sentence['w']):
                failures.append(prefix + ': word time outside sentence')
            if i and data['sentences'][i - 1]['b'] > sentence['a'] + .001:
                failures.append(prefix + ': sentence audio overlap')
        for note in data['notes']:
            if note['expr'].lower() not in data['sentences'][note['n'] - 1]['s'].lower():
                failures.append(folder.name + ': expression is missing from its sentence')
        for name in ['audio/episode.mp4', 'images/cover.jpg', 'handout.html', 'notes.md']:
            if not (folder / name).is_file() or (folder / name).stat().st_size == 0:
                failures.append(folder.name + ': missing ' + name)
        if (folder / 'audio' / 'episode.mp4').stat().st_size != (ROOT / 'episodes' / folder.name / 'audio' / 'episode.mp4').stat().st_size:
            failures.append(folder.name + ': audio size changed')
    if courses != 39:
        failures.append('Expected 39 courses, got ' + str(courses))
    archive = next((ROOT.parent.parent / 'dist').glob('HwFee-English-精听39节-修订版-*.zip'))
    with zipfile.ZipFile(archive) as packaged:
        if packaged.testzip():
            failures.append('ZIP checksum error')
        if sum(name.endswith('/player.html') for name in packaged.namelist()) != 39:
            failures.append('ZIP course count mismatch')
        # Compare the unchanged audio to the previous shipped archive using ZIP CRCs.
        with zipfile.ZipFile(next((ROOT / 'dist').rglob('*含封面.zip'))) as previous:
            for item in packaged.infolist():
                if item.filename.endswith('/audio/episode.mp4'):
                    old_name = item.filename.replace('unified/', 'cet6/', 1)
                    if (item.CRC, item.file_size) != (previous.getinfo(old_name).CRC, previous.getinfo(old_name).file_size):
                        failures.append(item.filename + ': audio differs from previous shipped course')
    report = {'courses': courses, 'sentences': sentences,
              'max_source_words': max(value[0] for value in lengths), 'max_source_characters': max(value[1] for value in lengths),
              'max_translation_characters': max(value[2] for value in lengths), 'failures': failures}
    (ROOT.parent / 'archive' / 'unified-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())

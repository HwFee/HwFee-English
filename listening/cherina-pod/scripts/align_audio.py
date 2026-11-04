#!/usr/bin/env python3
"""Align cached caption words to local audio without changing the transcript.

Optional dependencies: numpy, torch, transformers. Model downloads once; audio stays local.
The CTC path uses the recurrence documented in PyTorch's forced-alignment tutorial:
https://docs.pytorch.org/audio/stable/tutorials/forced_alignment_tutorial.html
"""

import argparse
import json
import math
import re
import subprocess
import time
from pathlib import Path

MODEL = 'facebook/wav2vec2-base-960h'
ROOT = Path(__file__).resolve().parent.parent
SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def number(n):
    if n < 20:
        return SMALL[n]
    if n < 100:
        return TENS[n // 10] + (' ' + SMALL[n % 10] if n % 10 else '')
    for value, name in [(1_000_000_000, 'billion'), (1_000_000, 'million'), (1000, 'thousand'), (100, 'hundred')]:
        if n >= value:
            return number(n // value) + ' ' + name + (' ' + number(n % value) if n % value else '')
    raise ValueError(n)


def normalize(text):
    text = re.sub(r'\[[^]]*\]', '', text).replace('’', "'").replace('‘', "'")
    text = re.sub(r'\d[\d,]*', lambda m: number(int(m[0].replace(',', ''))), text)
    return re.sub(r"[^A-Z' ]", '', text.upper()).strip().replace(' ', '|')


def ctc_path(emission, labels, blank=0):
    """Viterbi over blank/character states; retain emitting frames only for word edges."""
    import numpy as np
    tokens = np.full(len(labels) * 2 + 1, blank, dtype=np.int64)
    tokens[1::2] = labels
    count = len(tokens)
    scores = np.full(count, -np.inf, dtype=np.float32)
    scores[0] = 0
    back = np.zeros((len(emission), count), dtype=np.int8)
    skip = np.zeros(count, dtype=bool)
    skip[2:] = (tokens[2:] != blank) & (tokens[2:] != tokens[:-2])
    for t, frame in enumerate(emission):
        one = np.r_[-np.inf, scores[:-1]]
        two = np.r_[-np.inf, -np.inf, scores[:-2]]
        two[~skip] = -np.inf
        choices = np.stack([scores, one, two])
        back[t] = choices.argmax(axis=0)
        scores = choices.max(axis=0) + frame[tokens]
    state = count - 1 if scores[-1] > scores[-2] else count - 2
    if not math.isfinite(float(scores[state])):
        raise ValueError('No complete CTC path')
    frames = [[] for _ in labels]
    for t in range(len(emission) - 1, -1, -1):
        if state % 2:
            frames[state // 2].append(t)
        state -= int(back[t, state])
    return frames


class Aligner:
    def __init__(self):
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2CTCTokenizer
        self.torch = torch
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        torch.set_num_threads(4)
        self.model = Wav2Vec2ForCTC.from_pretrained(MODEL).to(self.device).eval()
        self.vocab = Wav2Vec2CTCTokenizer.from_pretrained(MODEL).get_vocab()
        self.revision = getattr(self.model.config, '_commit_hash', None)

    def align(self, pcm, words, start, end):
        import numpy as np
        first, last = max(0, int(start * 16000)), min(len(pcm), int(end * 16000))
        wave = pcm[first:last].copy()
        wave = (wave - wave.mean()) / np.sqrt(wave.var() + 1e-7)
        text, spans = '', []
        for word in words:
            clean = normalize(word['word'])
            if not clean:
                spans.append(None)
                continue
            if text:
                text += '|'
            a = len(text)
            text += clean
            spans.append((a, len(text)))
        if not text:
            return [None] * len(words)
        labels = [self.vocab[char] for char in text]
        with self.torch.inference_mode():
            tensor = self.torch.from_numpy(wave).unsqueeze(0).to(self.device)
            emission = self.model(tensor).logits[0].float().log_softmax(-1).cpu().numpy()
        path = ctc_path(emission, labels)
        stride = self.model.config.inputs_to_logits_ratio / 16000
        result = []
        for span in spans:
            if span is None:
                result.append(None)
                continue
            a, b = span
            hit = sorted(frame for i in range(a, b) for frame in path[i])
            if not hit:
                result.append(None)
                continue
            confidence = [max(float(emission[t, labels[i]]) for t in path[i]) for i in range(a, b) if path[i]]
            result.append({'start': round(first / 16000 + hit[0] * stride, 3),
                           'end': round(first / 16000 + (hit[-1] + 1) * stride, 3),
                           'score': round(math.exp(sum(confidence) / len(confidence)), 4)})
        return result


def align_episode(aligner, episode, limit=None):
    import numpy as np
    transcript = json.loads((episode / 'transcript.json').read_text('utf-8'))
    words = transcript['words']
    cached = episode / 'alignment.json'
    if cached.exists() and limit is None:
        old = json.loads(cached.read_text('utf-8'))
        if old.get('complete') and len(old.get('words', [])) == len(words):
            print(json.dumps({'episode': episode.name, 'cached': True}), flush=True)
            return old
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(episode / 'audio' / 'episode.mp4'),
                          '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True, check=True).stdout
    pcm = np.frombuffer(raw, dtype='<f4')
    output = [None] * len(words)
    cursor = 0
    started = time.monotonic()
    total = len(words) if limit is None else min(len(words), limit)
    while cursor < total:
        stop = cursor + 1
        while stop < total and words[stop]['start'] - words[cursor]['start'] < 18:
            stop += 1
        a, b = max(0, cursor - 3), min(len(words), stop + 3)
        start = max(0, words[a]['start'] - .7)
        end = min(len(pcm) / 16000, words[b - 1]['end'] + .8)
        aligned = aligner.align(pcm, words[a:b], start, end)
        for i in range(cursor, stop):
            output[i] = aligned[i - a]
        cursor = stop
    rows = [{'word': word['word'], 'caption_start': word['start'], 'caption_end': word['end'],
             **(aligned or {'start': word['start'], 'end': word['end'], 'score': 0})}
            for word, aligned in zip(words[:total], output[:total])]
    report = {'model': MODEL, 'revision': aligner.revision, 'complete': total == len(words),
              'seconds': round(time.monotonic() - started, 1), 'words': rows}
    cached.write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps({'episode': episode.name, 'words': total, 'seconds': report['seconds'],
                      'low_confidence': sum(word['score'] < .2 for word in rows)}, ensure_ascii=False), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episodes', nargs='*', type=Path)
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    episodes = args.episodes
    if args.all:
        episodes += [ROOT / 'episodes' / path.name for path in sorted((ROOT / 'lessons' / 'cet6').iterdir()) if path.is_dir()]
    if not episodes:
        parser.error('Specify an episode directory or --all')
    aligner = Aligner()
    for episode in episodes:
        align_episode(aligner, episode, args.limit)


if __name__ == '__main__':
    main()

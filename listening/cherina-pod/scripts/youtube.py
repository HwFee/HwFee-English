#!/usr/bin/env python3
"""YouTube 视频来源：用视频自带字幕生成 transcript.json，跳过付费 ASR。

字幕优先级：
  1. 人工字幕（subtitles）—— 句子干净、带标点；json3 只给句子级时间，词级按字符比例估算
  2. 自动字幕（automatic_captions）—— 有真实词级时间戳（tOffsetMs），但滚动窗口会重复词

两者都写成语义一致的 transcript.json（句级 + 词级时间戳，秒），下游 align.py /
build_lesson.py 完全不用改。视频没有任何字幕时报错，不会静默降级。

用法：
  python3 scripts/youtube.py "<YouTube 地址>" [--source-lang en] [--keep-original]

作为 lesson.py 的来源时由它调用 import_youtube()。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetch_podcast  # noqa: E402  slugify / episodes_root / compress_audio

YT_URL_RE = re.compile(
    r"(?:^https?://)?(?:www\.|m\.|music\.)?"
    r"(?:youtube\.com/(?:watch\?|shorts/|live/|embed/|v/)|youtu\.be/|youtube-nocookie\.com/embed/)",
    re.I,
)

# 语言优先级：源语言 → 常见变体 → 任意人工字幕兜底
LANG_PREF = {
    "en": ["en", "en-US", "en-GB", "en-orig"],
    "zh": ["zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW"],
    "ja": ["ja", "ja-JP"],
    "ko": ["ko", "ko-KR"],
    "fr": ["fr", "fr-FR"],
    "de": ["de", "de-DE"],
    "es": ["es", "es-ES", "es-419"],
}


def is_youtube_url(src):
    return bool(YT_URL_RE.search((src or "").strip()))


def ytdlp_path():
    return shutil.which("yt-dlp")


def _run(cmd, capture=True):
    """跑 yt-dlp。text 模式统一按 UTF-8 解，避免 Windows 用 cp936 解 JSON 里
    的中文标题时抛 UnicodeDecodeError。"""
    if capture:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
    return subprocess.run(cmd)


def probe(url):
    """yt-dlp -J 取元数据。Playlist 链接取第一条视频。"""
    exe = ytdlp_path()
    if not exe:
        raise RuntimeError("缺少 yt-dlp（pip install -U yt-dlp）")
    r = _run([exe, "-J", "--no-warnings", "--skip-download", "--no-playlist", url])
    if r.returncode != 0:
        tail = (r.stderr or r.stdout or "").strip()[-400:]
        raise RuntimeError(f"yt-dlp 读取视频信息失败：{tail}")
    text = r.stdout or ""
    # yt-dlp 会把弃用警告之类打到 stdout，从第一个 { 开始才是 JSON
    i = text.find("{")
    if i < 0:
        raise RuntimeError(f"yt-dlp 没有返回 JSON：{text.strip()[:300]}")
    info = json.loads(text[i:])
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise RuntimeError("这个播放列表里没有可下载的视频")
        print(f"  ℹ️ 收到播放列表，只取第一条：{entries[0].get('title')}")
        info = entries[0]
    if not info.get("id"):
        raise RuntimeError("YouTube 视频信息里没有 id")
    return info


def pick_subtitle(info, source_lang="en"):
    """只取源语言（默认英文）的字幕，不做跨语言兜底。

    这个工具只服务 en↔zh：素材本来就是英文的，拿到西班牙语/日语字幕再去翻中文没有意义。
    返回 (kind, lang)；该语言没有任何字幕时返回 (None, None)。
    """
    prefer = LANG_PREF.get((source_lang or "").lower()[:2], [(source_lang or "en").lower()])
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    for lang in prefer:
        if lang in manual:
            return "manual", lang
    for lang in prefer:
        if lang in auto:
            return "auto", lang
    return None, None


def download_captions(url, lang, kind, out_dir):
    """下载 json3 字幕，返回文件路径。"""
    exe = ytdlp_path()
    stem = os.path.join(str(out_dir), "cap")
    cmd = [
        exe, "--skip-download", "--no-playlist",
        "--sub-langs", lang, "--sub-format", "json3",
        "--write-auto-subs" if kind == "auto" else "--write-subs",
        "-o", stem, url,
    ]
    r = _run(cmd)
    files = [p for p in out_dir.iterdir() if p.name.startswith("cap.") and p.suffix == ".json3"]
    if not files:
        tail = (r.stderr or r.stdout or "").strip()[-300:]
        raise RuntimeError(f"字幕下载失败（{kind}/{lang}）：{tail}")
    return files[0]


def _estimate_words(text, start, end):
    """人工字幕没有词级时间：按字符数比例把句子时长摊到每个词上。"""
    toks = [t for t in re.split(r"\s+", text.strip()) if t]
    if not toks:
        return []
    total = sum(len(t) for t in toks) or 1
    span = max(end - start, 0.001)
    out, cur = [], start
    for t in toks:
        d = span * len(t) / total
        out.append({"word": t, "start": round(cur, 3), "end": round(cur + d, 3)})
        cur += d
    return out


def parse_manual(data):
    """人工字幕 json3：每个 event 就是一句完整的话。"""
    sentences, words = [], []
    for ev in data.get("events", []):
        segs = ev.get("segs") or []
        if not segs:
            continue  # 开头那条元数据事件没有文本
        text = "".join(s.get("utf8", "") for s in segs)
        # 人工字幕按版面折行，文本里带 \n；不归一化会让网页里出现硬换行
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        start = float(ev.get("tStartMs", 0)) / 1000.0
        dur = float(ev.get("dDurationMs", 0)) / 1000.0
        end = start + dur if dur > 0 else start + max(0.6, 0.06 * len(text))
        sentences.append({"text": text, "start": round(start, 3), "end": round(end, 3)})
        words.extend(_estimate_words(text, start, end))
    return sentences, words


def _auto_words(data):
    """自动字幕 json3：滚动窗口里同一词会重复出现，用 (词, 绝对毫秒) 去重。"""
    words, seen, last = [], set(), -1.0
    for ev in data.get("events", []):
        base = float(ev.get("tStartMs", 0))
        for seg in ev.get("segs") or []:
            txt = (seg.get("utf8") or "").strip()
            if not txt:
                continue
            abs_ms = base + float(seg.get("tOffsetMs") or 0)
            start = abs_ms / 1000.0
            key = (txt, int(abs_ms))
            if key in seen:
                continue
            if start < last - 0.001:  # 滚动窗口回退，已经在前面吐过
                continue
            seen.add(key)
            last = start
            words.append({"word": txt, "start": round(start, 3), "end": None})
    for i, w in enumerate(words):
        w["end"] = words[i + 1]["start"] if i + 1 < len(words) else round(w["start"] + 0.4, 3)
        if w["end"] <= w["start"]:
            w["end"] = round(w["start"] + 0.2, 3)
    return words


SENT_END_RE = re.compile(r"[.!?。！？…]$")
CLAUSE_END_RE = re.compile(r"[,;:，；：]$")


def group_sentences(words, max_words=28, clause_words=18, max_chars=180):
    """先收集完整语句，再按语义边界拆成手机能读完的短块。"""
    from sentence_chunks import split_source
    sentences = []
    cur = []

    def flush():
        if not cur:
            return
        expanded = []
        for word in cur:
            parts = word['word'].split()
            for index, part in enumerate(parts):
                span = word['end'] - word['start']
                start = word['start'] + span * index / len(parts)
                end = word['start'] + span * (index + 1) / len(parts)
                if expanded and re.fullmatch(r'[,;:.!?]+', part):
                    expanded[-1]['text'] += part
                    expanded[-1]['end'] = end
                else:
                    expanded.append({'text': part, 'start': start, 'end': end})
        text = ' '.join(word['text'] for word in expanded)
        if text:
            for chunk, start, stop in split_source({'s': text}, max_words=max_words, max_chars=max_chars):
                sentences.append({'text': chunk, 'start': expanded[start]['start'], 'end': expanded[stop - 1]['end']})
        cur.clear()

    for w in words:
        cur.append(w)
        n = len(cur)
        if (
            SENT_END_RE.search(w["word"])
            or (n >= clause_words and CLAUSE_END_RE.search(w["word"]))
        ):
            flush()
    flush()
    return sentences


def parse_auto(data):
    words = _auto_words(data)
    return group_sentences(words), words


def build_transcript(cap_path, kind, lang, duration):
    data = json.loads(Path(cap_path).read_text(encoding="utf-8"))
    sentences, words = parse_manual(data) if kind == "manual" else parse_auto(data)
    if not sentences:
        raise RuntimeError("字幕解析后没有任何句子（json3 结构可能变了）")
    # 词级时间戳必须存在，否则 transcribe.py 的缓存判定会认为需要重新转写
    if not words:
        words = []
        for s in sentences:
            words.extend(_estimate_words(s["text"], s["start"], s["end"]))
    return {
        "duration": round(max([duration] + [s["end"] for s in sentences]), 3),
        "sentences": sentences,
        "words": words,
        "audio": "audio/episode.mp4",
        "provider": "youtube-captions",
        "model": f"caption-{kind}:{lang}",
    }


def download_audio(url, audio_dir):
    """下音频并压成 AAC 64k mono。已有 episode.mp4 则跳过。"""
    compressed = audio_dir / "episode.mp4"
    if compressed.exists() and compressed.stat().st_size > 0:
        if fetch_podcast.is_valid_media(compressed):
            print(f"  ⏭️ 已有压缩音频（{compressed.stat().st_size / 1e6:.1f} MB），跳过下载")
            return compressed
        print("  ⚠️ 已有 episode.mp4 损坏，重新下载", file=sys.stderr)
        compressed.unlink()

    exe = ytdlp_path()
    print("  下载音频…")
    r = _run(
        [
            exe, "-f", "bestaudio/best", "--no-playlist", "-x",
            "--audio-format", "m4a",
            "-o", str(audio_dir / "source.%(ext)s"), url,
        ],
        capture=False,
    )
    if r.returncode != 0:
        raise RuntimeError("音频下载失败（视频可能需要登录/地区限制）")
    srcs = [p for p in audio_dir.iterdir() if p.name.startswith("source.")]
    if not srcs:
        raise RuntimeError("音频下载后找不到文件")
    return Path(fetch_podcast.compress_audio(str(srcs[0]), str(audio_dir), keep_original=False))


def import_youtube(url, source_lang="en", keep_original=False):
    """把一条 YouTube 视频导入为一期：episodes/<slug>/ + meta.json + transcript.json。"""
    if not ytdlp_path():
        raise RuntimeError("缺少 yt-dlp（pip install -U yt-dlp）")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("缺少 ffmpeg / ffprobe")

    print("读取视频信息…")
    info = probe(url)
    vid = info["id"]
    title = info.get("title") or vid
    duration = float(info.get("duration") or 0)
    print(f"视频：{title}（{_fmt_duration(duration)}）")

    kind, lang = pick_subtitle(info, source_lang)
    if kind is None:
        raise RuntimeError(
            "这个视频没有字幕（人工和自动都没有）。可以换一个有字幕的视频，"
            "或改用本地音频 + DASHSCOPE_API_KEY 走 ASR 转写。"
        )
    print(f"字幕：{'人工' if kind == 'manual' else '自动'}（{lang}）")

    slug_base = fetch_podcast.slugify(title) or "youtube"
    ep_dir = Path(fetch_podcast.episodes_root()) / f"{slug_base[:60]}-{vid}"
    audio_dir = ep_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    print("下载字幕…")
    cap_path = download_captions(url, lang, kind, ep_dir)
    transcript = build_transcript(cap_path, kind, lang, duration)
    print(
        f"  ✅ {len(transcript['sentences'])} 句 / {len(transcript['words'])} 词，"
        f"时长 {transcript['duration']:.0f}s"
    )

    audio_path = download_audio(url, audio_dir)

    meta = {
        "podcast": {
            "title": info.get("channel") or info.get("uploader") or "YouTube",
            "author": info.get("uploader") or "",
            "description": "",
            "image": info.get("thumbnail") or "",
            "feed_url": "",
            "link": info.get("webpage_url") or url,
        },
        "episode": {
            "title": title,
            "description": (info.get("description") or "")[:2000],
            "pub_date": info.get("upload_date") or "",
            "duration": _fmt_duration(duration),
            "audio_url": "",
            "image": info.get("thumbnail") or "",
            "video_id": vid,
            "source_url": info.get("webpage_url") or url,
        },
        # 浏览器只认正斜杠：Windows 的 os.path.relpath 会给 audio\episode.mp4
        "audio_path": os.path.relpath(str(audio_path), str(ep_dir)).replace(os.sep, "/"),
    }
    (ep_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (ep_dir / "transcript.json").write_text(
        json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ meta.json / transcript.json 已写入：{ep_dir}")

    # 原始 json3 留着：重新生成网页时不用再联网（字幕也可能被下架）
    keep = ep_dir / f"captions.{lang}.json3"
    if cap_path.exists() and not keep.exists():
        shutil.move(str(cap_path), str(keep))
    if not keep_original:
        for leftover in ep_dir.glob("cap.*.json3"):
            if leftover != keep:
                leftover.unlink(missing_ok=True)
    return str(ep_dir)


def _fmt_duration(seconds):
    seconds = int(seconds or 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def list_video(url, source_lang="en"):
    """给 lesson.py --list 用：单条视频也返回 episodes 契约（1 条）。"""
    info = probe(url)
    kind, lang = pick_subtitle(info, source_lang)
    return {
        "podcast": info.get("channel") or info.get("uploader") or "YouTube",
        "episodes": [
            {
                "n": 1,
                "title": info.get("title") or info.get("id"),
                "date": info.get("upload_date") or "",
                "duration": _fmt_duration(float(info.get("duration") or 0)),
            }
        ],
        "captions": (
            f"{'人工' if kind == 'manual' else '自动'}:{lang}" if kind else "无字幕"
        ),
        "video_id": info.get("id"),
    }


def main():
    ap = argparse.ArgumentParser(description="把一条 YouTube 视频导入为一期精听课素材")
    ap.add_argument("url")
    ap.add_argument("--source-lang", default="en", help="视频语言（en / zh / ja …，默认 en）")
    ap.add_argument("--keep-original", action="store_true", help="保留原始音频与字幕文件")
    args = ap.parse_args()
    try:
        ep_dir = import_youtube(args.url, args.source_lang, args.keep_original)
    except RuntimeError as e:
        print(f"❌ {e}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "dir": ep_dir}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

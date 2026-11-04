#!/usr/bin/env python3
"""批量把频道里的 YouTube 视频导入为精听课。

分两段，第一段不花钱（下载音频 + 视频自带字幕 → transcript.json），
第二段只在译文齐全时构建网页（没有译文就跳过，不会生成半成品）。

用法：
  python3 scripts/batch_youtube.py "https://www.youtube.com/@EnglishWithEvie/videos"
  python3 scripts/batch_youtube.py "<channel or playlist url>" --limit 5
  python3 scripts/batch_youtube.py "<url>" --list-only
  python3 scripts/batch_youtube.py "<url>" --build --level 六级

可断点续跑：已有 transcript.json + episode.mp4 的视频直接跳过。
最后一行输出 RESULT {json}（ok / prepared / built / skipped / failed）。
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import norm_text  # noqa: E402
import youtube  # noqa: E402


def enumerate_videos(url, limit=None):
    """用 yt-dlp 列出频道/列表里的视频 id 与标题。"""
    exe = youtube.ytdlp_path()
    if not exe:
        raise RuntimeError("缺少 yt-dlp（pip install -U yt-dlp）")
    r = subprocess.run(
        [exe, "--flat-playlist", "--no-warnings", "--print", "%(id)s\t%(duration)s\t%(title)s", url],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(f"列出视频失败：{(r.stderr or '').strip()[-300:]}")
    out = []
    for line in (r.stdout or "").splitlines():
        parts = line.split("\t")
        if len(parts) < 2 or not parts[0].strip():
            continue
        vid = parts[0].strip()
        try:
            dur = float(parts[1])
        except ValueError:
            dur = 0.0
        title = parts[2] if len(parts) > 2 else ""
        out.append({"id": vid, "duration": dur, "title": title})
    if limit:
        out = out[:limit]
    return out


def translation_complete(ep_dir):
    """译文是否覆盖 transcript 的每一句（与 translate.py 的判定一致）。"""
    tr = ep_dir / "transcript.json"
    tl = ep_dir / "translation.json"
    if not (tr.exists() and tl.exists()):
        return False, 0, 0
    try:
        sents = json.loads(tr.read_text(encoding="utf-8"))["sentences"]
        pairs = json.loads(tl.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, KeyError):
        return False, 0, 0
    done = {norm_text(p.get("source", p.get("en", ""))) for p in pairs if isinstance(p, dict)}
    missing = [s for s in sents if norm_text(s["text"]) not in done]
    return (not missing), len(sents) - len(missing), len(sents)


def run(script, *args):
    cmd = [sys.executable, str(HERE / script), *map(str, args)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        tail = "\n".join(l for l in (r.stdout + r.stderr).splitlines() if l.strip())[-400:]
        raise RuntimeError(f"{script} 失败：{tail}")
    return r.stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", nargs="?", help="频道 / 播放列表 / 单视频地址")
    ap.add_argument("--ids", help="直接给逗号分隔的 video ID，跳过枚举（用于并行分片）")
    ap.add_argument("--limit", type=int, help="只处理前 N 个视频")
    ap.add_argument("--list-only", action="store_true", help="只列出视频，不下载")
    ap.add_argument("--build", action="store_true", help="译文齐全时顺带构建精听课")
    ap.add_argument("--level", default="六级", help="构建时的水平（默认 六级）")
    ap.add_argument("--source-lang", default="en")
    ap.add_argument("--target-lang", default="zh")
    args = ap.parse_args()

    t0 = time.time()
    try:
        if args.ids:
            videos = [
                {"id": x.strip(), "duration": 0, "title": ""}
                for x in args.ids.split(",")
                if x.strip()
            ]
        else:
            videos = enumerate_videos(args.url, args.limit)
    except RuntimeError as e:
        print(f"❌ {e}", file=sys.stderr)
        print("RESULT " + json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 2
    if not videos:
        print("❌ 没列出任何视频", file=sys.stderr)
        print("RESULT " + json.dumps({"ok": False, "error": "没列出任何视频"}, ensure_ascii=False))
        return 2

    total_min = sum(v["duration"] for v in videos) / 60
    print(f"共 {len(videos)} 个视频，合计 {total_min:.0f} 分钟\n")
    if args.list_only:
        for i, v in enumerate(videos, 1):
            print(f"[{i:2}] {v['duration'] / 60:5.1f} min  {v['title']}  ({v['id']})")
        print("RESULT " + json.dumps({"ok": True, "count": len(videos), "minutes": round(total_min)}, ensure_ascii=False))
        return 0

    prepared, built, skipped, failed = [], [], [], []
    for i, v in enumerate(videos, 1):
        url = f"https://www.youtube.com/watch?v={v['id']}"
        print(f"\n===== [{i}/{len(videos)}] {v['title'] or v['id']} ({v['duration'] / 60:.1f} min) =====", flush=True)
        try:
            ep = Path(youtube.import_youtube(url, source_lang=args.source_lang))
        except RuntimeError as e:
            print(f"  ⚠️ 跳过：{e}", file=sys.stderr)
            failed.append({"id": v["id"], "title": v["title"], "error": str(e)})
            continue

        ok, have, need = translation_complete(ep)
        if ok:
            prepared.append({"id": v["id"], "dir": str(ep), "sentences": need})
        else:
            print(f"  ℹ️ 暂无完整译文（{have}/{need} 句），只准备好素材", flush=True)
            prepared.append({"id": v["id"], "dir": str(ep), "sentences": need, "translated": have})

        if args.build and ok:
            try:
                lang = ["--source-lang", args.source_lang, "--target-lang", args.target_lang]
                run("align.py", ep, *lang)
                run("build_lesson.py", ep, "--level", args.level, "--single-file")
                built.append(v["id"])
                print("  ✅ 精听课已构建", flush=True)
            except RuntimeError as e:
                print(f"  ⚠️ 构建失败：{e}", file=sys.stderr)
                failed.append({"id": v["id"], "title": v["title"], "error": str(e)})
        elif args.build:
            skipped.append(v["id"])

    mins = (time.time() - t0) / 60
    print(
        f"\n完成：{len(prepared)} 个素材就绪，{len(built)} 个已构建，"
        f"{len(skipped)} 个等译文，{len(failed)} 个失败，用时 {mins:.1f} 分钟"
    )
    print(
        "RESULT "
        + json.dumps(
            {
                "ok": True,
                "count": len(videos),
                "prepared": prepared,
                "built": built,
                "waiting_translation": skipped,
                "failed": failed,
                "elapsed_minutes": round(mins, 1),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

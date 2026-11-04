#!/usr/bin/env python3
"""一部素材 → 四级 / 六级 两份桌面版精听课。

素材留在 episodes/<slug>-<id>/（音频、transcript、translation），
成品分别写进 lessons/cet4/<slug>/ 和 lessons/cet6/<slug>/，音频用硬链接共用，
两份课各自带自己的 20 条难点表达，互不影响。

一部素材需要两个难点文件：
  episodes/<slug>/notes-4.json   —— 四级水平（偏高频、基础搭配）
  episodes/<slug>/notes-6.json   —— 六级水平（偏进阶搭配、时态、俚语）
格式都是 [{"n": 句号, "expr": "原句里的连续片段", "type": "类型", "explain": "解释"}]

用法：
  python3 scripts/two_levels.py episodes/<slug>
  python3 scripts/two_levels.py episodes/<slug1> episodes/<slug2>
  python3 scripts/two_levels.py --all        # episodes/ 下所有已备齐双难点文件的
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

LEVELS = [
    ("cet4", "四级", "notes-4.json"),
    ("cet6", "六级", "notes-6.json"),
]


def run(script, *args):
    cmd = [sys.executable, str(HERE / script), *map(str, args)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        tail = "\n".join(l for l in out.splitlines() if l.strip())[-400:]
        raise RuntimeError(f"{script} 失败：{tail}")
    return out


def link_or_copy(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    try:
        os.link(src, dst)  # 硬链接：同一卷上不占额外空间
        return "hardlink"
    except OSError:
        shutil.copy2(src, dst)
        return "copy"


def build_one(ep, folder, level_cn, notes_name):
    ep = ep.resolve()
    notes_src = ep / notes_name
    if not notes_src.exists():
        raise RuntimeError(f"缺少 {notes_name}（{level_cn} 的难点表达）")

    dest = ROOT / "lessons" / folder / ep.name
    dest.mkdir(parents=True, exist_ok=True)

    audio_src = ep / "audio" / "episode.mp4"
    if not audio_src.exists():
        raise RuntimeError(f"缺少音频 {audio_src}")
    how = link_or_copy(audio_src, dest / "audio" / "episode.mp4")

    for name in ("bilingual.json", "transcript.json"):
        if not (ep / name).exists():
            raise RuntimeError(f"缺少 {name}")
        shutil.copy2(ep / name, dest / name)

    shutil.copy2(notes_src, dest / "notes.json")
    # 广告标记必须从素材带过来：build_lesson 按整句精确匹配来删句子，
    # 这里若写死 [] 就等于把素材里识别出的赞助口播全部丢了。
    ads_src = ep / "ads.json"
    if ads_src.exists():
        shutil.copy2(ads_src, dest / "ads.json")
    else:
        (dest / "ads.json").write_text("[]", encoding="utf-8")

    out = run("build_lesson.py", dest, "--level", level_cn)
    line = next((l for l in out.splitlines() if "句，" in l and "难点" in l), "")
    return dest, how, line.strip()


def prepare(ep):
    """确保 bilingual.json 存在（translation.json 齐全时生成）。"""
    ep = Path(ep).resolve()
    if not (ep / "transcript.json").exists():
        raise RuntimeError("素材未就绪：缺少 transcript.json（后台下载还没跑到这一集）")
    if not (ep / "translation.json").exists():
        raise RuntimeError("缺少 translation.json（还没翻译）")
    run("align.py", ep, "--source-lang", "en", "--target-lang", "zh")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("episodes", nargs="*", help="素材目录（episodes/<slug>）")
    ap.add_argument("--all", action="store_true", help="处理 episodes/ 下所有双难点齐全的素材")
    ap.add_argument("--keep-phone", action="store_true", help="额外生成手机单文件（默认不生成）")
    args = ap.parse_args()

    targets = []
    if args.all:
        for d in sorted((ROOT / "episodes").iterdir()):
            if d.is_dir() and (d / "notes-4.json").exists() and (d / "notes-6.json").exists():
                targets.append(d)
    targets += [Path(p) for p in args.episodes]
    if not targets:
        print("没有要处理的目标。给目录，或者用 --all。", file=sys.stderr)
        return 2

    built, failed = [], []
    for ep in targets:
        print(f"\n===== {ep.name} =====", flush=True)
        try:
            prepare(ep)
        except RuntimeError as e:
            print(f"  ❌ {e}", file=sys.stderr)
            failed.append({"episode": ep.name, "error": str(e)})
            continue
        for folder, level_cn, notes_name in LEVELS:
            try:
                dest, how, line = build_one(ep, folder, level_cn, notes_name)
                print(f"  ✅ {level_cn} → {dest.relative_to(ROOT)}（音频 {how}）", flush=True)
                if line:
                    print(f"     {line}", flush=True)
                if args.keep_phone:
                    run("build_lesson.py", dest, "--level", level_cn, "--single-file")
                built.append({"episode": ep.name, "level": level_cn, "dir": str(dest)})
            except RuntimeError as e:
                print(f"  ❌ {level_cn}：{e}", file=sys.stderr)
                failed.append({"episode": ep.name, "level": level_cn, "error": str(e)})

    print(f"\n完成：{len(built)} 份成功，{len(failed)} 份失败")
    print("RESULT " + json.dumps({"ok": not failed, "built": built, "failed": failed}, ensure_ascii=False))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())

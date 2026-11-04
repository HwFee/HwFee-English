#!/usr/bin/env python3
"""把课程打包成能直接发给别人的 zip。

两种包：
  单节包：`dist/单节/<期名>.zip`，里面同时含四级和六级两份，解压双击 player.html 就能练。
          一节约 17 MB（音频占绝大部分），微信/AirDrop 都能发。
  整库包：`dist/整库/cherina-pod-四级-39节.zip`，含课程库 index.html + 全部 39 节。

用法：
  python3 scripts/pack_share.py --all-lessons              # 每节一个包（含四级+六级）
  python3 scripts/pack_share.py --lesson <期名>             # 只打一节
  python3 scripts/pack_share.py --library both             # 四级、六级各一个整库包

> 进度不在包里：练习记录存在浏览器 localStorage，跟设备走，发文件带不过去。
"""

import argparse
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LESSONS = ROOT / "lessons"
DIST = ROOT / "dist"

LEVEL_CN = {"cet4": "四级", "cet6": "六级"}

README = """如何打开这节精听课
==================

解压后会有 cet4/ 和 cet6/ 两个文件夹，分别是四级版和六级版：
    双击对应文件夹里的 player.html，用浏览器打开即可（音频已随包，离线可用）。

两份课的音频、原文、译文完全一样，只有「难点表达」的 20 条不同：
    四级版  偏基础短语动词、易混词义、常用搭配
    六级版  偏完成进行时、比较与强调结构、英式俚语

怎么练：
    1  盲听      不看原文，先整体听一遍，点「精听」继续
    2  精听      每句播完自动停，点模糊的字才显示原文
    3  对照      逐词高亮，难点表达点开看解释
    4  再盲听    和第一遍对比，看进步幅度

打印：打开 handout.html，点「打印 / 存为 PDF」，可切成听写版。

注意：练习进度存在你自己的浏览器里（localStorage），换设备、换浏览器、
      清浏览器数据都会丢；它不是账号系统，也不会同步给对方。
"""


def add(z, src, arcname):
    """音频已经是压缩格式，用 STORED 省时间；文本用 DEFLATED。"""
    comp = zipfile.ZIP_STORED if src.suffix.lower() in (".mp4", ".m4a", ".mp3") else zipfile.ZIP_DEFLATED
    z.write(src, arcname, compress_type=comp)


def pack_lesson(slug, levels, out_dir):
    src_levels = [lv for lv in levels if (LESSONS / lv / slug).is_dir()]
    if not src_levels:
        raise SystemExit(f"找不到课程：{slug}")
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{slug}.zip"
    with zipfile.ZipFile(dest, "w") as z:
        for lv in src_levels:
            base = LESSONS / lv / slug
            for name in ("player.html", "handout.html", "notes.md"):
                if (base / name).exists():
                    add(z, base / name, f"{lv}/{slug}/{name}")
            audio = base / "audio" / "episode.mp4"
            if audio.exists():
                add(z, audio, f"{lv}/{slug}/audio/episode.mp4")
        z.writestr("如何打开.txt", README)
    return dest, dest.stat().st_size


def pack_library(level, out_dir):
    base = LESSONS / level
    if not base.exists():
        raise SystemExit(f"找不到 {base}")
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"cherina-pod-{LEVEL_CN[level]}-39节.zip"
    with zipfile.ZipFile(dest, "w") as z:
        if (base / "index.html").exists():
            add(z, base / "index.html", f"{level}/index.html")
        # 使用教程放在包根目录，解压第一眼就能看到
        tut = base / "使用教程.html"
        if tut.exists():
            add(z, tut, "使用教程.html")
        for d in sorted(p for p in base.iterdir() if p.is_dir()):
            for name in ("player.html", "handout.html", "notes.md", "lesson.json"):
                if (d / name).exists():
                    add(z, d / name, f"{level}/{d.name}/{name}")
            audio = d / "audio" / "episode.mp4"
            if audio.exists():
                add(z, audio, f"{level}/{d.name}/audio/episode.mp4")
        z.writestr("如何打开.txt", "先双击包里的 使用教程.html 看图文教程。\n\n"
                                   "想直接开始：进入 " + level + "/ 文件夹，双击 index.html 打开课程库，\n"
                                   "点任意一节课即可。每节目录里的 handout.html 可以打印或存成 PDF。\n\n"
                                   "练习进度存在你自己的浏览器里，不在这些文件里，发给别人不会带过去。\n"
                                   "音频已随包，完全离线，不需要联网。\n")
    return dest, dest.stat().st_size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lesson", action="append", default=[], help="只打这一节（期名，可重复）")
    ap.add_argument("--all-lessons", action="store_true", help="每节打一个包")
    ap.add_argument("--library", choices=["cet4", "cet6", "both"], help="打整库包")
    ap.add_argument("--levels", default="cet4,cet6", help="单节包里放哪些版本，默认两个都放")
    args = ap.parse_args()

    levels = [x.strip() for x in args.levels.split(",") if x.strip() in LEVEL_CN]
    if not levels:
        raise SystemExit("--levels 只能是 cet4 / cet6")

    slugs = list(args.lesson)
    if args.all_lessons:
        slugs = sorted(d.name for d in (LESSONS / "cet4").iterdir() if d.is_dir())
        slugs += [d.name for d in (LESSONS / "cet6").iterdir() if d.is_dir() and d.name not in slugs]
    if not slugs and not args.library:
        ap.print_help()
        return 2

    made = []
    if slugs:
        out = DIST / "单节"
        for i, s in enumerate(slugs, 1):
            dest, size = pack_lesson(s, levels, out)
            made.append({"type": "lesson", "file": str(dest), "mb": round(size / 1e6, 1)})
            print(f"[{i}/{len(slugs)}] {dest.name}  {size / 1e6:.1f} MB", flush=True)

    if args.library:
        libs = ["cet4", "cet6"] if args.library == "both" else [args.library]
        for lv in libs:
            dest, size = pack_library(lv, DIST / "整库")
            made.append({"type": "library", "file": str(dest), "mb": round(size / 1e6, 1)})
            print(f"{dest.name}  {size / 1e6:.1f} MB", flush=True)

    total = sum(x["mb"] for x in made)
    print(f"\n完成 {len(made)} 个包，合计 {total:.0f} MB，输出在 {DIST}")
    print("RESULT " + json.dumps({"ok": True, "packages": made, "total_mb": round(total, 1)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

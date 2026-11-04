#!/usr/bin/env python3
"""打一个手机用的集合包：每节课一个单文件 HTML（音频内嵌），加一个手机优先的课表。

和桌面包的区别：
  - 桌面包是文件夹结构（player.html + audio/），要整个目录一起拷。
  - 手机包是单文件，一个 HTML 里装好音频，微信/AirDrop 传过去点开就能练。
  - 单文件模式播放器会隐藏「回到课程库」，所以这里给每页补一个「← 课表」浮动按钮。

用法：
  python3 scripts/pack_mobile.py                 # 打包四级 39 节
  python3 scripts/pack_mobile.py --level cet6
  python3 scripts/pack_mobile.py --limit 3       # 先打 3 节试水
"""

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LESSONS = ROOT / "lessons"
DIST = ROOT / "dist"

LEVEL_CN = {"cet4": "四级", "cet6": "六级"}

BACK_LINK = """<style>#backIdx{position:fixed;left:14px;bottom:14px;z-index:99;background:#f5f4ed;color:#1b365d;
border:1px solid #d9d4c6;border-radius:999px;padding:9px 16px;font:14px/1 Charter,Georgia,"Songti SC",serif;
text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.08)}</style>
<a id="backIdx" href="index.html">← 课表</a>
"""

CSS = """
:root{--paper:#f5f4ed;--ink:#1b365d;--text:#2f2b26;--muted:#6f6659;--rule:#d9d4c6;--warm:#e8e3d6}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--paper);color:var(--text);
 font:16px/1.7 Charter,Georgia,"Songti SC","SimSun","Noto Serif CJK SC",serif}
.wrap{max-width:680px;margin:0 auto;padding:34px 18px 60px}
.kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
h1{font-size:26px;line-height:1.32;margin:0 0 10px;font-weight:600}
.lede{color:var(--muted);font-size:14px;margin:0 0 6px}
.meta{display:flex;gap:20px;margin:18px 0 8px;font-size:12px;color:var(--muted)}
.meta b{color:var(--ink);font-size:17px;display:block;font-weight:600}
h2{font-size:13px;letter-spacing:.14em;color:var(--muted);font-weight:400;
 margin:30px 0 6px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
a.row{display:flex;align-items:center;gap:14px;padding:15px 4px;border-bottom:1px solid var(--rule);
 text-decoration:none;color:var(--text)}
a.row:active{background:var(--warm)}
a.row .wpm{flex:0 0 46px;text-align:right;color:var(--ink);font-size:17px;font-variant-numeric:tabular-nums}
a.row .wpm small{display:block;color:var(--muted);font-size:9px;letter-spacing:.08em}
a.row .body{flex:1;min-width:0}
a.row .t{font-size:15px;line-height:1.35}
a.row .d{color:var(--muted);font-size:12px;margin-top:3px}
a.row .go{color:var(--rule);font-size:18px}
footer{margin-top:34px;font-size:12px;color:var(--muted);border-top:1px solid var(--rule);padding-top:16px}
"""


def ensure_single_file(ep_dir):
    share = ep_dir / "share"
    name = ep_dir.name + ".html"
    f = share / name
    if f.exists():
        return f
    r = subprocess.run(
        [sys.executable, str(HERE / "build_lesson.py"), str(ep_dir), "--single-file"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if r.returncode != 0 or not f.exists():
        tail = "\n".join(l for l in ((r.stdout or "") + (r.stderr or "")).splitlines() if l.strip())[-300:]
        raise RuntimeError(f"{ep_dir.name} 单文件生成失败：{tail}")
    return f


def build_index(level, rows):
    cn = LEVEL_CN[level]
    total = sum(x["min"] for x in rows)
    speeds = [x["rate"] for x in rows if x["rate"]]
    groups = [
        ("慢速 · 适合起步", lambda r: r < 110),
        ("中等 · 日常语速", lambda r: 110 <= r < 135),
        ("偏快 · 挑战用", lambda r: r >= 135),
    ]
    sections = []
    for title, test in groups:
        picked = [x for x in rows if test(x["rate"] or 0)]
        if not picked:
            continue
        items = "\n".join(
            f'<a class="row" href="{x["file"]}">'
            f'<div class="wpm">{x["rate"]}<small>WPM</small></div>'
            f'<div class="body"><div class="t">{x["title"]}</div>'
            f'<div class="d">{x["min"]:.0f} 分钟 · {x["seg"]} 段</div></div>'
            f'<div class="go">›</div></a>'
            for x in picked
        )
        sections.append(f"<h2>{title}（{len(picked)} 节）</h2>\n{items}")
    body = "\n".join(sections)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>英语精听课 · {cn} · {len(rows)} 节</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
  <p class="kicker">English with Evie · {cn}版</p>
  <h1>英语精听课<br>{len(rows)} 节</h1>
  <p class="lede">点任意一节开始。每句播完自动停，点模糊的字才显示原文。</p>
  <div class="meta">
    <div><b>{len(rows)}</b>节</div>
    <div><b>{total:.0f}′</b>总时长</div>
    <div><b>{min(speeds)}–{max(speeds)}</b>语速</div>
  </div>
  {body}
  <footer>
    音频已内嵌在每节课的文件里，飞行模式也能听。<br>
    练习记录存在本机浏览器，清缓存或换设备会丢。
  </footer>
</div>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--level", default="cet4", choices=["cet4", "cet6"])
    ap.add_argument("--limit", type=int, help="只打前 N 节（按语速从慢到快）")
    ap.add_argument(
        "--group",
        choices=["all", "slow", "mid", "fast"],
        default="all",
        help="all=整包；slow/mid/fast=只打这一段（慢<110、中110-134、快>=135 wpm），"
             "分包体积小，方便微信分批发",
    )
    args = ap.parse_args()

    base = LESSONS / args.level
    dirs = sorted(d for d in base.iterdir() if d.is_dir() and (d / "lesson.json").exists())
    rows = []
    for d in dirs:
        m = json.loads((d / "lesson.json").read_text(encoding="utf-8"))
        rows.append({
            "dir": d,
            "file": d.name + ".html",
            "title": (m.get("title") or "").strip(),
            "min": (m.get("duration") or 0) / 60,
            "seg": m.get("segments") or 0,
            "rate": m.get("rate") or 0,
        })
    rows.sort(key=lambda x: (x["rate"] or 999, x["min"]))
    group_tag = ""
    if args.group != "all":
        pred = {
            "slow": lambda r: r < 110,
            "mid": lambda r: 110 <= r < 135,
            "fast": lambda r: r >= 135,
        }[args.group]
        rows = [x for x in rows if pred(x["rate"] or 0)]
        group_tag = {"slow": "-慢速", "mid": "-中等", "fast": "-偏快"}[args.group]
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        raise SystemExit("这一组没有课程")

    out_dir = DIST / "手机版"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"cherina-pod-手机版-{LEVEL_CN[args.level]}{group_tag}-{len(rows)}节.zip"

    tn, kw = 0, 0
    with zipfile.ZipFile(dest, "w") as z:
        z.writestr("index.html", build_index(args.level, rows))
        tut = base / "使用教程.html"
        if tut.exists():
            z.writestr("使用教程.html", tut.read_text(encoding="utf-8"))
        z.writestr(
            "如何打开.txt",
            "这是手机版：每节课是一个独立的 HTML 文件，音频已经装在里面。\n\n"
            "用法：在这个文件夹里打开 index.html，点任意一节课就能练；飞行模式也能听。\n"
            "想发单节给朋友：直接发对应的那个 HTML 文件，不用发整个包。\n\n"
            "记录说明：练习进度存在手机的浏览器里，清缓存、换浏览器或换设备都会丢。\n",
        )
        for i, x in enumerate(rows, 1):
            src = ensure_single_file(x["dir"])
            html = src.read_text(encoding="utf-8")
            if "</body>" in html:
                html = html.replace("</body>", BACK_LINK + "</body>", 1)
            z.writestr(x["file"], html)
            tn += 1
            kw = dest.stat().st_size // 1024 if dest.exists() else 0
            print(f"[{i}/{len(rows)}] {x['file']}  {len(html)/1e6:.1f} MB（HTML）", flush=True)

    total_mb = dest.stat().st_size / 1e6
    print(f"\n完成：{tn} 节，包 {total_mb:.0f} MB -> {dest}")
    print("RESULT " + json.dumps(
        {"ok": True, "file": str(dest), "lessons": tn, "mb": round(total_mb, 1)},
        ensure_ascii=False,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())

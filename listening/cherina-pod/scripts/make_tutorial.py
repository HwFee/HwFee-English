#!/usr/bin/env python3
"""生成分享包里的使用教程（Kami 风格：暖米纸底、墨蓝点缀、衬线、大留白）。

只读 lessons/cet4 下的 lesson.json，把 39 节课的时长/段数/语速排成表，
输出自包含 HTML（无外链、无网络请求），供 dist 里的整库包直接带上。

用法：
  python3 scripts/make_tutorial.py                # 默认生成四级版
  python3 scripts/make_tutorial.py --level cet6
"""

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

CSS = """
:root{--paper:#f5f4ed;--ink:#1b365d;--text:#2f2b26;--muted:#6f6659;--rule:#d9d4c6;--warm:#e8e3d6}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--text);
 font:16px/1.78 Charter,Georgia,"Songti SC","SimSun","Noto Serif CJK SC",serif;letter-spacing:.01em}
.page{max-width:760px;margin:0 auto;padding:72px 28px 120px}
header{border-bottom:1px solid var(--rule);padding-bottom:40px;margin-bottom:56px}
.kicker{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin:0 0 18px}
h1{font-size:40px;line-height:1.25;margin:0 0 18px;font-weight:600;letter-spacing:-.01em}
.lede{font-size:17px;color:var(--muted);margin:0;max-width:34em}
.meta{display:flex;flex-wrap:wrap;gap:28px;margin-top:32px}
.meta div{font-size:13px;color:var(--muted)}
.meta b{display:block;font-size:22px;color:var(--ink);font-weight:600;letter-spacing:0}
h2{font-size:21px;margin:64px 0 8px;font-weight:600;color:var(--ink)}
h2 .n{font-size:12px;letter-spacing:.18em;color:var(--muted);display:block;margin-bottom:10px;font-weight:400}
h3{font-size:16px;margin:32px 0 6px;font-weight:600}
p{margin:14px 0}
ol,ul{margin:14px 0;padding-left:1.4em}
li{margin:8px 0}
code{font:13px/1.5 "SF Mono",Consolas,monospace;background:var(--warm);padding:2px 6px;border-radius:3px}
hr{border:0;border-top:1px solid var(--rule);margin:56px 0}
table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}
th{text-align:left;font-weight:600;color:var(--ink);font-size:12px;letter-spacing:.1em;
 border-bottom:1px solid var(--ink);padding:10px 10px 10px 0;text-transform:uppercase}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--rule);vertical-align:top}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--muted);width:64px}
.steps{counter-reset:s;list-style:none;padding:0}
.steps li{counter-increment:s;position:relative;padding-left:44px;margin:22px 0}
.steps li::before{content:counter(s);position:absolute;left:0;top:2px;width:28px;height:28px;
 border:1px solid var(--ink);border-radius:50%;color:var(--ink);font-size:13px;
 display:flex;align-items:center;justify-content:center}
.note{border-left:2px solid var(--ink);padding:2px 0 2px 18px;margin:26px 0;color:var(--muted);font-size:15px}
.note b{color:var(--text)}
kbd{font:12px/1 "SF Mono",Consolas,monospace;border:1px solid var(--rule);border-bottom-width:2px;
 border-radius:4px;padding:3px 7px;background:#fff;color:var(--ink)}
footer{margin-top:88px;padding-top:32px;border-top:1px solid var(--rule);font-size:13px;color:var(--muted)}
a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--rule)}
a:hover{border-bottom-color:var(--ink)}
@media print{body{background:#fff}.page{padding:0}h2{page-break-after:avoid}table{page-break-inside:auto}}
"""


def rows(level):
    root = ROOT / "lessons" / level
    out = []
    for d in sorted(root.iterdir()):
        f = d / "lesson.json"
        if not f.exists():
            continue
        m = json.loads(f.read_text(encoding="utf-8"))
        out.append({
            "title": (m.get("title") or "").strip(),
            "min": round((m.get("duration") or 0) / 60, 1),
            "seg": m.get("segments") or 0,
            "rate": m.get("rate") or 0,
            "sent": m.get("sentences") or 0,
        })
    return out


def build(level):
    rows_ = rows(level)
    rows_.sort(key=lambda x: (x["rate"] or 999, x["min"]))
    total_min = sum(x["min"] for x in rows_)
    rates = [x["rate"] for x in rows_ if x["rate"]]
    slow, fast = (min(rates), max(rates)) if rates else (0, 0)
    cn = "四级" if level == "cet4" else "六级"

    table = "\n".join(
        f'<tr><td class="num">{x["rate"]}</td><td>{x["title"]}</td>'
        f'<td class="num">{x["min"]:.0f}′</td><td class="num">{x["seg"]}</td></tr>'
        for x in rows_
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>英语精听课 · {len(rows_)} 节 · {cn}版 · 使用教程</title>
<style>{CSS}</style>
</head>
<body>
<div class="page">

<header>
  <p class="kicker">Use Guide · {cn}版</p>
  <h1>英语精听课<br>{len(rows_)} 节，共 {total_min:.0f} 分钟</h1>
  <p class="lede">来自 English with Evie 频道的英式英语素材，逐句切好、配了中文译文，
  每节还标了 {len(rows_)} 条最值得记的表达。全部离线，不用注册，不用联网。</p>
  <div class="meta">
    <div><b>{len(rows_)}</b>节课</div>
    <div><b>{total_min:.0f}′</b>总时长</div>
    <div><b>{slow}–{fast}</b>语速 wpm</div>
    <div><b>2 种</b>讲义格式</div>
  </div>
</header>

<h2><span class="n">01 · 开始</span>三步进入第一节课</h2>
<ol class="steps">
  <li><b>解压整个压缩包</b>到一个固定文件夹，比如「文档 / 英语精听」。
      不要只解压单个文件——课程库里每节课都要读同级目录的音频。</li>
  <li><b>双击 <code>{level}\\index.html</code></b>，用浏览器打开课程库。
      推荐 Chrome 或 Edge。</li>
  <li><b>点任意一节课</b>进入播放页。第一次建议从语速最慢的开始，
      文末的表格已经按语速从慢到快排好了。</li>
</ol>
<div class="note"><b>为什么建议固定文件夹：</b>课程库会记住你上次练到哪一节，
这个记录存在浏览器的本地存储里，按页面地址区分。挪了位置就当成新课。</div>

<h2><span class="n">02 · 方法</span>一节课怎么练</h2>
<p>精听不是「听三遍就完事」。每节课都按顺序走四步，页面上点一下就会自动进下一步：</p>

<h3>第一步 盲听</h3>
<p>不看文字，整段听一遍。听不懂很正常，这一步的意义是留下「哪里卡住」的印象。
结束后给自己打个分，比如 30%。</p>

<h3>第二步 精听</h3>
<p>一句一句来。每句播完自动停，屏幕上的字是<b>模糊</b>的——先试着听出整句，
实在不行点一下模糊的字偷看原文，再听一遍。</p>

<h3>第三步 对照</h3>
<p>逐词高亮跟着音频走，哪一句听不懂就停下来盯着看。
带下划线的表达可以点开看解释，那就是这节课的难点笔记。</p>

<h3>第四步 再盲听</h3>
<p>把文字全部收起来，再完整听一遍，重新打一次分。
两次分数的差就是这节的效果，页面会直接算给你看。</p>

<div class="note">一节课 15 分钟左右，四步走完大约 30–40 分钟。
时间紧就只做「盲听 + 精听」，效果已经拿到了大半。</div>

<h2><span class="n">03 · 操作</span>键盘比鼠标快</h2>
<table>
<tr><th>按键</th><th>作用</th></tr>
<tr><td><kbd>空格</kbd></td><td>播放 / 暂停</td></tr>
<tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>上一句 / 下一句</td></tr>
<tr><td><kbd>R</kbd></td><td>单句循环（卡在一句时最有用）</td></tr>
<tr><td><kbd>T</kbd></td><td>精听时偷看原文（只在第二步有效）</td></tr>
<tr><td><kbd>1</kbd>–<kbd>4</kbd></td><td>直接切到某一步</td></tr>
<tr><td><kbd>Esc</kbd></td><td>关掉侧栏和弹层</td></tr>
</table>
<p>点进度条上任意一格可以跳到对应那一句；左上角可以切段，
一节课被拆成了 4–10 段，练不完可以只练一段。</p>

<h2><span class="n">04 · 讲义</span>打印或存成 PDF</h2>
<p>每节课目录下都有一个 <code>handout.html</code>。打开后点「打印 / 存为 PDF」，
浏览器会按 A4 排版：左边原文、右边译文，每句下面留了订正的空行。</p>
<p>它还带一个<b>听写版</b>开关——切换后只剩编号和空行，答案附在最后，
适合先听写再对答案。打印前可以选范围，一小时的节目不用全打。</p>

<h2><span class="n">05 · 关于记录</span>进度存在哪</h2>
<p>练习进度、连续天数、收藏的句子都存在<b>你电脑的浏览器</b>里，不上传任何服务器。
这意味着三件事：</p>
<ul>
  <li>换浏览器、换电脑、清浏览器缓存，记录就没了——它不是一个账号。</li>
  <li>把文件发给别人，你的打卡不会跟着过去，对方从零开始。</li>
  <li>想保留记录就别用无痕窗口打开。</li>
</ul>
<p>如果你希望记录更稳，可以让懂电脑的人在本机跑一个小服务再打开
（同一地址访问，记录就不会因为路径变化而丢）；纯双击打开也能用，
只是浏览器对本地文件的存储策略各不相同。</p>

<h2><span class="n">06 · 清单</span>{len(rows_)} 节课，按语速从慢到快</h2>
<p>语速是平均每分钟词数，可以当作难度参考：先啃 84–110 wpm 的，
再往上走。每节标题后面的数字是时长和段数。</p>
<table>
<tr><th>wpm</th><th>课程</th><th>时长</th><th>段</th></tr>
{table}
</table>

<h2><span class="n">07 · 版权</span>这些内容来自哪里</h2>
<p>音频和原文来自 YouTube 频道 <b>English with Evie</b>，版权归原作者。
这里做的是把公开视频整理成便于精听的本地材料，仅供<b>个人学习</b>使用，
请不要公开传播或用于商业用途。喜欢她的内容，建议去 YouTube 关注支持。</p>
<p>排版和工具链来自开源项目 cherina-pod（AGPL-3.0）。</p>

<footer>
  英语精听课 · {cn}版 · {len(rows_)} 节 / {total_min:.0f} 分钟<br>
  双击 <code>{level}\\index.html</code> 开始 · 本页可离线打开，也可直接打印
</footer>

</div>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--level", default="cet4", choices=["cet4", "cet6"])
    args = ap.parse_args()
    dest = ROOT / "lessons" / args.level / "使用教程.html"
    dest.write_text(build(args.level), encoding="utf-8")
    print(f"✅ 已生成 {dest}（{dest.stat().st_size / 1024:.0f} KB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

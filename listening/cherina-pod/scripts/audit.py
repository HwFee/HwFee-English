#!/usr/bin/env python3
"""全量验收：39 部素材 × 四级/六级 两份成品，逐项检查。

检查内容
  素材：transcript.json / translation.json（句数齐全、无空译文）/ notes-4.json / notes-6.json（各 20 条、expr 在原句内）
  成品：lessons/<cet4|cet6>/<slug>/player.html + handout.html + notes.md + audio/episode.mp4，
        页面内嵌数据里 notes 条数为 20、句子数与素材一致；不应存在 share/ 手机单文件

用法：
  python3 scripts/audit.py            # 全量
  python3 scripts/audit.py --verbose  # 打印每个问题
最后一行输出 RESULT {json}
"""

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from common import norm_text  # noqa: E402

LEVELS = ["cet4", "cet6"]

# 流水线早期用手工素材验证过的别家视频，不属于本次交付，审计时跳过
SKIP_VIDEO_IDS = {"9uZ-jeZS8d0"}


def load(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def check_notes(ep, name, sents, errs):
    items = load(ep / name)
    if items is None:
        errs.append(f"素材缺少 {name}")
        return
    if len(items) != 20:
        errs.append(f"{name} 有 {len(items)} 条（应 20）")
    for x in items:
        n = x.get("n")
        if not isinstance(n, int) or not (1 <= n <= len(sents)):
            errs.append(f"{name} 句号越界 {n}")
            continue
        src = sents[n - 1]["text"]
        expr = (x.get("expr") or "").strip()
        if not expr or expr.lower() not in src.lower():
            errs.append(f"{name} #{n} expr 不在原句：{expr!r}")
        if not (x.get("type") or "").strip():
            errs.append(f"{name} #{n} 缺 type")
        if not (x.get("explain") or "").strip():
            errs.append(f"{name} #{n} 缺 explain")


def check_level(ep, folder, level_cn, sents_count, errs):
    """核对一份成品。删过广告句的，句子数和难点条数都要按 ads.json 折算。"""
    dest = ROOT / "lessons" / folder / ep.name
    if not dest.exists():
        errs.append(f"缺少成品 lessons/{folder}/{ep.name}")
        return False
    for f in ("player.html", "handout.html", "notes.md"):
        if not (dest / f).exists():
            errs.append(f"{folder} 缺 {f}")
    if not (dest / "audio" / "episode.mp4").exists():
        errs.append(f"{folder} 缺音频")
    if (dest / "share").exists():
        errs.append(f"{folder} 出现了 share/ 手机单文件（要求不要）")

    ads = set(load(dest / "ads.json") or [])
    src_notes = load(ep / f"notes-{'4' if folder == 'cet4' else '6'}.json") or []
    # 落在被删广告句上的难点，构建时会被自然丢弃，条数要跟着减
    expected_notes = len([x for x in src_notes if x.get("src") not in ads])
    expected_sents = sents_count - len(ads)

    ph = dest / "player.html"
    if ph.exists():
        html = ph.read_text(encoding="utf-8", errors="replace")
        m = re.search(r'<script type="application/json" id="data">(.*?)</script>', html, re.S)
        if not m:
            errs.append(f"{folder} player.html 里找不到数据块")
        else:
            try:
                d = json.loads(m.group(1))
            except json.JSONDecodeError:
                errs.append(f"{folder} player.html 数据块不是合法 JSON")
                d = None
            if d:
                got_notes = len(d.get("notes") or [])
                if got_notes != expected_notes:
                    errs.append(
                        f"{folder} 页面难点 {got_notes} 条（应为 {expected_notes}"
                        f"{f'，已扣掉广告句上的 {len(src_notes) - expected_notes} 条' if ads else ''}）"
                    )
                got_sents = len(d.get("sentences") or [])
                if got_sents != expected_sents:
                    errs.append(
                        f"{folder} 页面句子 {got_sents}（应为 {expected_sents}"
                        f"{f'，素材 {sents_count} 减广告 {len(ads)}' if ads else ''}）"
                    )
                if not any(s.get("t") for s in d.get("sentences") or []):
                    errs.append(f"{folder} 页面没有译文")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    eps = [
        d for d in sorted((ROOT / "episodes").iterdir())
        if d.is_dir()
        and d.name != "_sample-intro"
        and not any(v in d.name for v in SKIP_VIDEO_IDS)
    ]
    ok, bad, pending = [], [], []
    for ep in eps:
        errs = []
        tr = load(ep / "transcript.json")
        if tr is None:
            pending.append({"episode": ep.name, "reason": "素材未下载"})
            continue
        sents = tr.get("sentences") or []
        tl = load(ep / "translation.json")
        if tl is None:
            pending.append({"episode": ep.name, "reason": "未翻译"})
            continue
        if len(tl) != len(sents):
            errs.append(f"译文 {len(tl)} 条 / 原文 {len(sents)} 句")
        empties = sum(1 for x in tl if not str(x.get("target", "")).strip())
        if empties:
            errs.append(f"{empties} 句空译文")
        for i, (s, p) in enumerate(zip(sents, tl), 1):
            if norm_text(p.get("source", "")) != norm_text(s["text"]):
                errs.append(f"#{i} source 与原文不符")
                break
        check_notes(ep, "notes-4.json", sents, errs)
        check_notes(ep, "notes-6.json", sents, errs)
        both = all(check_level(ep, f, cn, len(sents), errs) for f, cn in zip(LEVELS, ["四级", "六级"]))
        if not both:
            pending.append({"episode": ep.name, "reason": "成品未生成"})
        if errs:
            bad.append({"episode": ep.name, "errors": errs})
        elif both:
            ok.append(ep.name)

    total = len(eps)
    print(f"素材目录：{total}")
    print(f"✅ 完整（双水平都通过）：{len(ok)}")
    print(f"❌ 有问题：{len(bad)}")
    print(f"⏳ 待处理：{len(pending)}")
    if bad:
        print("\n有问题的：")
        for b in bad:
            n = len(b["errors"])
            print(f"  {b['episode']}（{n} 个问题）")
            if args.verbose:
                for e in b["errors"][:12]:
                    print(f"      - {e}")
    if pending and args.verbose:
        print("\n待处理：")
        for p in pending:
            print(f"  {p['episode']} —— {p['reason']}")
    print("RESULT " + json.dumps(
        {"ok": not bad and not pending, "complete": len(ok), "problems": bad, "pending": pending},
        ensure_ascii=False,
    ))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())

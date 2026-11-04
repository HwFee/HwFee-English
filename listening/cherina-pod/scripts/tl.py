#!/usr/bin/env python3
"""翻译用的两个小工具。

  python3 scripts/tl.py dump  <期目录>            # 列出编号 + 原文，供手工翻译
  python3 scripts/tl.py check <期目录>            # 校验 translation.json / notes.json

check 会检查：句子数是否一致、source 是否与 transcript 逐字相同（顺序也查）、
译文是否为空、notes.json 的 expr 是否真的出现在对应原句里。
写 translation.json 时按 transcript 的句子顺序、source 原样复制即可。
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import norm_text  # noqa: E402


def load_transcript(ep):
    p = Path(ep) / "transcript.json"
    if not p.exists():
        raise SystemExit(f"找不到 {p}")
    return json.loads(p.read_text(encoding="utf-8"))["sentences"]


def cmd_dump(ep):
    sents = load_transcript(ep)
    print(f"# {ep}")
    print(f"# {len(sents)} sentences")
    for i, s in enumerate(sents, 1):
        print(f"{i}\t{s['text']}")


def cmd_check(ep):
    sents = load_transcript(ep)
    ep = Path(ep)
    problems = []

    tl = ep / "translation.json"
    if not tl.exists():
        problems.append("translation.json 不存在")
    else:
        try:
            pairs = json.loads(tl.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise SystemExit(f"translation.json 不是合法 JSON：{e}")
        if len(pairs) != len(sents):
            problems.append(f"translation.json 有 {len(pairs)} 条，原文 {len(sents)} 句")
        for i, (s, p) in enumerate(zip(sents, pairs), 1):
            src = p.get("source", p.get("en", ""))
            tgt = p.get("target", p.get("zh", ""))
            if norm_text(src) != norm_text(s["text"]):
                problems.append(f"#{i} source 与原文不一致：{src[:50]!r} != {s['text'][:50]!r}")
            if not str(tgt).strip():
                problems.append(f"#{i} 译文为空")

    note_files = ["notes-4.json", "notes-6.json"]
    if (ep / "notes.json").exists():
        note_files.append("notes.json")
    missing_level = [n for n in ("notes-4.json", "notes-6.json") if not (ep / n).exists()]
    if missing_level:
        problems.append(f"缺少 {', '.join(missing_level)}（四级/六级各要一份 20 条）")

    for name in note_files:
        nt = ep / name
        if not nt.exists():
            continue
        try:
            notes = json.loads(nt.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            problems.append(f"{name} 不是合法 JSON：{e}")
            continue
        if len(notes) < 20:
            problems.append(f"{name} 只有 {len(notes)} 条，要求 20 条")
        seen = set()
        for x in notes:
            n = x.get("n")
            if not isinstance(n, int) or not (1 <= n <= len(sents)):
                problems.append(f"{name} 里的 n 越界：{n}")
                continue
            src = sents[n - 1]["text"]
            if x.get("src") and norm_text(x["src"]) != norm_text(src):
                problems.append(f"{name} #{n} 的 src 与原文不一致")
            expr = (x.get("expr") or "").strip()
            if not expr:
                problems.append(f"{name} #{n} 缺少 expr")
            elif expr.lower() not in src.lower():
                problems.append(f"{name} #{n} 的 expr {expr!r} 不在原句里")
            if (n, x.get("expr")) in seen:
                problems.append(f"{name} #{n} 重复条目")
            seen.add((n, x.get("expr")))
            for k in ("type", "explain"):
                if not str(x.get(k) or "").strip():
                    problems.append(f"{name} #{n} 缺少 {k}")

    if problems:
        print(f"❌ {len(problems)} 个问题：")
        for p in problems[:40]:
            print("  - " + p)
        return 1
    n4 = len(json.loads((ep / "notes-4.json").read_text(encoding="utf-8")))
    n6 = len(json.loads((ep / "notes-6.json").read_text(encoding="utf-8")))
    print(f"✅ 全部通过：{len(sents)} 句译文 + 四级 {n4} 条 / 六级 {n6} 条难点")
    return 0


def cmd_fill(ep, zh_path):
    """把纯中文译文（数组或 {序号: 中文}）按顺序回填成 translation.json。

    source 直接从 transcript 取，避免手抄原文出错——这是批量翻译最常见的事故来源。
    """
    sents = load_transcript(ep)
    raw = json.loads(Path(zh_path).read_text(encoding="utf-8"))
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = [raw.get(str(i), "") for i in range(1, len(sents) + 1)]
    else:
        raise SystemExit("译文文件应是数组或 {序号: 中文} 对象")
    if len(items) != len(sents):
        raise SystemExit(f"译文 {len(items)} 条，原文 {len(sents)} 句，数量不一致")
    out = [
        {"source": s["text"], "target": str(z).strip()}
        for s, z in zip(sents, items)
    ]
    (Path(ep) / "translation.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    blank = sum(1 for x in out if not x["target"])
    print(f"✅ 写入 {len(out)} 句译文 -> translation.json（空译文 {blank} 条）")


def cmd_notes(ep, items_path, out_name="notes.json"):
    """把难点表达填成 notes.json / notes-4.json / notes-6.json。
    只给 n / expr / type / explain，src 从原句回填。

    句号写错但 expr 确实在文中时，自动定位到包含它的那一句（唯一匹配才采纳），
    避免手工数句子数错一位就整批失败。
    """
    sents = load_transcript(ep)
    items = json.loads(Path(items_path).read_text(encoding="utf-8"))
    out = []
    for it in items:
        n = it.get("n")
        expr = str(it.get("expr") or "").strip()
        if not expr:
            raise SystemExit("有条目缺少 expr")
        if not isinstance(n, int) or not (1 <= n <= len(sents)):
            n = None
        if n is not None and expr.lower() in sents[n - 1]["text"].lower():
            good = n
        else:
            hits = [i + 1 for i, s in enumerate(sents) if expr.lower() in s["text"].lower()]
            if len(hits) == 1:
                print(f"  ℹ️ {expr!r}: 句号 {it.get('n')} → {hits[0]}（自动定位）")
                good = hits[0]
            elif not hits:
                raise SystemExit(f"expr {expr!r} 在整篇原文里都找不到")
            else:
                raise SystemExit(
                    f"expr {expr!r} 出现在多句 {hits[:6]}，请手动指定 n"
                )
        src = sents[good - 1]["text"]
        out.append({
            "n": good,
            "src": src,
            "expr": expr,
            "type": str(it.get("type") or "").strip(),
            "explain": str(it.get("explain") or "").strip(),
        })
    (Path(ep) / out_name).write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"✅ 写入 {len(out)} 条难点表达 -> {out_name}")


def cmd_ads(ep, items_path):
    """写广告句清单 ads.json。传入整句原文数组（或 {"sentences": [...]}）。

    build_lesson 是按整句精确匹配来删句子的，所以每句必须与 transcript 完全一致。
    """
    sents = load_transcript(ep)
    raw = json.loads(Path(items_path).read_text(encoding="utf-8"))
    items = raw.get("sentences") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise SystemExit('ads 文件应为句子数组，或 {"sentences": [...]}')
    exact = {s["text"] for s in sents}
    bad = [x for x in items if str(x) not in exact]
    if bad:
        raise SystemExit(f"这句在原文里找不到（要逐字一样）：{str(bad[0])[:90]}")
    (Path(ep) / "ads.json").write_text(
        json.dumps([str(x) for x in items], ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"✅ 写入 {len(items)} 句广告标记 -> ads.json")


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("dump", "check", "fill", "notes", "ads"):
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "fill":
        if len(sys.argv) != 4:
            raise SystemExit("用法：python scripts/tl.py fill <期目录> <中文.json>")
        return cmd_fill(sys.argv[2], sys.argv[3])
    if cmd == "ads":
        if len(sys.argv) != 4:
            raise SystemExit("用法：python scripts/tl.py ads <期目录> <广告句.json>")
        return cmd_ads(sys.argv[2], sys.argv[3])
    if cmd == "notes":
        if len(sys.argv) not in (4, 5):
            raise SystemExit("用法：python scripts/tl.py notes <期目录> <items.json> [输出文件名=notes.json]")
        return cmd_notes(sys.argv[2], sys.argv[3], *(sys.argv[4:5] or ["notes.json"]))
    return cmd_dump(sys.argv[2]) if cmd == "dump" else cmd_check(sys.argv[2])


if __name__ == "__main__":
    sys.exit(main() or 0)

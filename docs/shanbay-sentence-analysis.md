# 长难句 / 句式分析 — wire protocol

Reverse-engineered from `扇贝翻译` v0.17.1 (`{09767ac2-b538-a31e-5ddd-2ad053169458}`) in the Zen profile,
extracted to `.tmp/shanbay-ext/xpi/`. Wire behaviour below was **captured live** on 2026-11-03 against a
logged-in account (one call per endpoint); the raw streams are reproduced verbatim in this file.

Two endpoints make the 长难句 card: `sentence_analysis` (the segmented analysis) and `translate_sentence`
(the translation under it). Both are SSE, both are metered, both authenticate with the browser cookie only.

## Where the feature is triggered

There is no toolbar button and no context menu. Selection bubble → `长难句分析` tab
(`content.js:531857` sends, `background.js:189746` handles).

| Constraint | Value | Source |
|---|---|---|
| Trigger | bubble icon next to selection (`trigger:'icon'`) or direct mode | `content.js:` selection toolbar |
| Text sent | `getRangeAt(0).cloneContents().textContent`, `.bay-translation-bilingual` stripped, `trim()` | content.js |
| Word gate for the analyze tab | 10 ≤ words ≤ 120 | `content.js:166045` `Cs=10`, `ws=120`; gate in `Ps()` at `content.js:174817` |
| Hard selection cap | 300 words — bubble disabled, "已选 N 词，上限 300 词" | `Ts=300`, same constants; tip at `content.js:177609` |
| Sentence splitting | **none** — a multi-sentence selection is sent as one blob | `Ns()` is dead code (no call site passes `resolveSelectionGate`) |

Word count is counted as whitespace tokens containing at least one `[A-Za-z]`.

## Request

```
POST https://sse.shanbay.com/bay-translate/sse/sentence_analysis
Content-Type: application/json
Cookie: auth_token=…; csrftoken=…        (browser sends it; extension uses credentials:'include')

{"request_id":"analysis-<tabId>-<cardId>-<seq>","text":"<selected text>"}
```

- Exactly two body fields. No `model`, no `target_lang`, no `lang`, no page URL, no surrounding paragraph.
- `request_id` is generated in the content script as `` `analysis-${tabId}-${cardId}-${++counter}` ``
  (`content.js:531857`); the translation path uses `` `sel-${tabId}-${cardId}-${++counter}` ``. It is a
  correlation id, **not** a UUID and not validated by the server — a `crypto.randomUUID()` was accepted in
  the capture below.
- Only header the extension sets is `Content-Type`; the rest is the browser's (Origin `https://web.shanbay.com`,
  cookie jar). From outside a browser you must send `Cookie`, `X-CSRFToken`, `Origin`, `Referer` — the last
  four were required in the Android app, and were used for this capture.
- No length truncation client-side; the 300-word cap above is the only bound.

## Response — SSE stream

Framing (`background.js:151928` client): split the byte stream on `\n\n`, ignore the trailing partial frame,
line prefixes `event: ` and `data: `, last occurrence wins, each `data:` line is one JSON object.
Events arrive in this order; only `component` repeats.

| Event | `data` payload | Notes |
|---|---|---|
| `component` | `{type, text, label}` | one per span, **in sentence order** |
| `usage` | `{remaining_percent}` | integer 0–100, sent once before `done` |
| `done` | `{"status":"ok"}` | payload ignored by the extension |
| `quota_exceeded` | `{reset_at}` | no `component` frames precede it |
| `error` | `{code, message}` | no `component` frames precede it |

Live capture, 341 chars / 55 words (verbatim, `C:\Users\HwFee\AppData\Local\Temp\sbcap\sentence-analysis.sse.txt`):

```
event: component
data: {"type": "clause", "text": "While it is true that the rapid expansion of digital platforms has made information more accessible than ever before, ", "label": "让步状语从句"}

event: component
data: {"type": "subj", "text": "the very algorithms ", "label": "主语"}

event: component
data: {"type": "clause", "text": "that decide what we see, ", "label": "定语从句"}

event: component
data: {"type": "nonpred", "text": "shaped by commercial incentives rather than editorial judgment, ", "label": "非谓语动词"}

event: component
data: {"type": "pred", "text": "tend ", "label": "谓语"}

event: component
data: {"type": "nonpred", "text": "to reinforce existing beliefs ", "label": "非谓语动词"}

event: component
data: {"type": "other", "text": "and, ", "label": "其他"}

event: component
data: {"type": "prep", "text": "in doing so, ", "label": "方式状语"}

event: component
data: {"type": "pred", "text": "quietly narrow ", "label": "谓语"}

event: component
data: {"type": "obj", "text": "the range of opinions ", "label": "宾语"}

event: component
data: {"type": "clause", "text": "to which we are exposed.", "label": "定语从句"}

event: usage
data: {"remaining_percent": 98}

event: done
data: {"status": "ok"}
```

**The spans tile the input exactly.** Concatenating `component[].text` in arrival order reproduces the request
`text` byte for byte (checked programmatically against the capture above, `concat === input`). So the sentence
can be rendered as one continuous line with per-span colouring — no offsets, no gaps, no reassembly logic.
Leading/trailing spaces are significant and already present in each span.

## Component types

Eight `type` values exist. The type → colour mapping is local (`Hp`, `content.js:384131`); every `label` is
server-sent Chinese and carries the detail the type alone does not.

| `type` | colour (bg / label) | slot | labels seen |
|---|---|---|---|
| `subj` | `#ebe2ff` / `#9f7dea` | 主语 | 主语 |
| `pred` | `#e7f5e9` / `#77c081` | 谓语 | 谓语 |
| `obj` | `#fff3e0` / `#f59d20` | 宾语 | 宾语 |
| `clause` | `#ffdad6` / `#eb6356` | 从句 | 让步状语从句, 定语从句, … |
| `prep` | `#e3f2fd` / `#37a3f2` | 介词短语类状语 | 方式状语 |
| `nonpred` | `#fff5c5` / `#b99b00` | 非谓语 | 非谓语动词 |
| `appos` | `#fde8ef` / `#d9779b` | 同位语 | unverified: not hit by this capture |
| `other` | `#e9e9e9` / `#aaaaaa` | 兜底 | 其他 |

`other` is the client's fallback colour too, so an unknown future type degrades gracefully to grey.

Semantic note from the capture: `clause` spans include their subordinating conjunction or relative pronoun
and their trailing comma/space; `pred` spans are the verb only (`tend `, `quietly narrow `), and a coordinate
structure yields two `pred` spans with an `other` span holding `and, `. Expect spans to be phrase-sized, not
clause-sized.

## Translation — the same sentence's `translate_sentence`

```
POST https://sse.shanbay.com/bay-translate/sse/translate_sentence
{"request_id":"…","text":"…","target_lang":"zh-CN"}
```

`target_lang` is the only extra field; the extension hardcodes `zh-CN` (`` `sel-${tab}-${card}-${n}` `` id).
Response is a token stream — `token` frames, then `usage`, then `done` which repeats the whole string:

```
event: token
data: {"t": "尽管"}

event: token
data: {"t": "数字"}
…
event: usage
data: {"remaining_percent": 91}

event: done
data: {"t": "尽管数字平台的迅速扩张确实使信息比以往任何时候都更容易获取，但决定我们看到什么内容的算法，往往受商业利益驱动而非编辑判断，这容易强化已有的观点，从而悄然缩小了我们接触不同意见的范围。"}
```

Append `token[].t` for the live effect; `done.t` is the authoritative full text (use it if you only need the
final result, or to verify your accumulation). No deltas, no sequence numbers.

## Quota and auth

- `usage.remaining_percent` reports quota within SSE. The independent REST endpoint
  `GET https://apiv3.shanbay.com/bay-translate/quota` was found in the extension and verified on
  2026-11-04; see [the endpoint map](shanbay-api.md). Measured: analysis of 55 words took **2** points (100 → 98), the translation of the same
  sentence took **7** (98 → 91). `reset_at` in `quota_exceeded` is when the allowance returns.
- `401` → `{code:'unauthorized', message:'登录已过期，请重新登录'}`; the extension also clears the stored
  `account` and shows a login modal.
- `403` on this endpoint is reported as plain `HTTP 403` — unlike `translate_sentence`, there is **no**
  `vip_required` branch and the 400 body is not parsed.
- Extension-side swallowing worth knowing before you copy the pattern:
  - `fetch` rejection (offline, DNS, TLS) produces **no** callback at all — the card sits on its skeleton forever.
  - No timeout, no retry, no `reader.cancel()`. The `AbortController` `fr()` returns is discarded by its only
    caller and no cancel message exists, so an in-flight analysis cannot be stopped.
  - `usage` is forwarded as `bay-analysis-usage` but **nothing in `content.js` listens** (0 occurrences), and
    `quota_exceeded`'s `reset_at` is dropped (`onQuotaExceeded:()=>{ … '今日免费额度已用完，明日重置' }`).
    Both render as generic request failures.

## Caller envelope (extension internals, for reference)

```
content.js  →  {type:'bay-analyze-sentence', requestId, text}        (3 keys only)
background  →  {started:true} | {error:'no tab'}                      (fire-and-forget ack)
background  →  bay-analysis-component   {requestId, component}
               bay-analysis-usage       {requestId, usage}            ← never read
               bay-analysis-done        {requestId}
               bay-analysis-error       {requestId, error}
               bay-auth-expired                                       ← 401, also clears storage 'account'
```

No caching anywhere on this path: reopening the card refetches with a fresh `requestId`. The only
persistence is the bookmark store — IndexedDB `bay-translate-bookmarks` / `bookmarks`
(`id, [userId+sentenceHash], [userId+createdAt]`, field `analysis`) and cloud
`apiv3.shanbay.com/bay-translate/bookmarks`, which stores the finished `analysis` array. No TTL.

## Reproducing the capture

The capture script lives outside the repo — `%TEMP%\sbcap\capture.mjs`, next to `dump_cookies.py` — because it
reads the cookie jar and must never be committed. Each run spends real quota: two calls cost 9 points.

Cookies came from `cookies.sqlite` in the Zen profile (`auth_token`, `csrftoken` on `.shanbay.com`, both valid
to 2027-01-31). Header set used: `Cookie`, `X-CSRFToken`, `Origin: https://web.shanbay.com`,
`Referer: https://web.shanbay.com/`, `Accept: text/event-stream`. Response headers worth knowing:
`content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`,
`access-control-allow-origin: https://web.shanbay.com` + `allow-credentials: true` — i.e. CORS only trusts
the web origin, so a native client has no CORS constraint but a different web origin will be refused.

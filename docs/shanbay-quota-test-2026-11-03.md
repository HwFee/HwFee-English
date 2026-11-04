Use the measured 7-percentage-point balance decrease as this article's observed result, not as a
fixed cost for future articles. The user explicitly authorized this account test.

| Item | Result |
|---|---|
| Test time | 2026-11-03 14:02:58–14:03:24, Asia/Shanghai; about 26 seconds. |
| Today's learning article | `ufzln`, “How Alberghi Diffusi Turn Villages Into Hotels” / “分散式酒店”：意大利乡村旅游发展模式. Learning date 2026-11-03; original publication 2023-05-20. |
| Text | 14 paragraphs, 657 English words, 37 unique sentences. |
| Requests | 37 sequential `POST /bay-translate/sse/translate_sentence` requests; all returned HTTP 200 and completed translations. |
| First / last observed balance | 91% after the first sentence; 84% after the last. Observed decrease: **7 percentage points**. |
| Personal LLM API / new analysis requests | 0 / 0. |

An earlier capture at 13:24 also showed 91%, but no free, fresh pre-request balance endpoint was
used. The server reports whole percentages, so fractional consumption of the first sentence is
unknown. Account activity elsewhere or balance replenishment can affect comparisons. The observed
91 → 84 change is supported; exact fractional billing and per-sentence pricing are not established.

Raw SSE and completed translations were retained outside the repository at
`C:/Users/HwFee/AppData/Local/Temp/sbcap/article-quota-2026-11-03/` for local verification. Credentials
were read in memory from the user's existing capture and were not printed or copied into source.
The native parser replayed all 37 translation streams and an existing 11-component analysis stream
successfully, without additional network requests. These temporary files are private test artifacts,
not a published fixture or the app's SQLite cache.

Mock-server and Robolectric tests cover repeat-cache reuse, manual/preparation request sharing,
quota fallback, partial streams, timeouts and cancellation. This account test establishes live
protocol compatibility and the observed balance change; it does not establish phone acceptance.
No APK was generated and no device operations were performed for this work.

Frontend integration: [sentence tools](llm-api.md) and [usage display](usage-api.md). Settings reads
local records only and must not repeat this paid test to refresh a balance.

Use `getUsage({days: 30})` to populate Settings. This reads local records and never spends Shanbay
quota or API tokens. The backend and the other model's Settings display ship in version 1.0.4.

DeepSeek monetary balance is a separate network read: see [getDeepSeekBalance](deepseek-balance-api.md).
It uses the saved official DeepSeek key and does not change this local-usage contract.

Settings also calls `getShanbayQuota({forceRefresh: false})`, a native authenticated
`GET /bay-translate/quota`. This account query works while sentence quota is zero or in cooldown;
it never submits a translation or analysis. Opening Settings reuses a successful observation for
up to 60 seconds; “重新读取” passes `forceRefresh: true`. The result has the same fields as `shanbay`
below. A positive balance clears an existing quota block, but not an unrelated permission block.
Reads are isolated by saved account, and an account change rejects with `CONFIG_CHANGED`.
Network/authentication/invalid-response errors preserve the last amount and observation time;
the card labels them as old values. The web timeout is 60 seconds. Local `getUsage` stays local.

```js
// From a module in web/:
import { getUsage } from './read/llm.mjs';
const usage = await getUsage({ days: 30 });
// Native equivalent: window.top.Capacitor.Plugins.Llm.getUsage({ days: 30 })
```

`days` defaults to 30 and must be an integer from 1 to 3650. The interval includes today and the
preceding `days - 1` calendar days in `Asia/Shanghai`. Invalid input rejects with `INVALID_ARGUMENT`;
storage failures reject with `STORAGE_ERROR`. The web helper has a 15-second timeout and reports
`NO_BRIDGE` in a browser without the native plugin. Reads use a separate executor, so an ongoing
sentence request does not occupy the usage-read queue.

## Response contract, schemaVersion 1

| Field | Type and meaning |
|---|---|
| `observedAt` | Unix milliseconds when this local snapshot was read. |
| `trackingSince` | Unix milliseconds when the usage ledger was created. Earlier activity cannot be reconstructed. |
| `period` | `{days, from, to, timeZone}`; dates are `YYYY-MM-DD`, inclusive. |
| `statsScope` | Always `"this_install_all_sessions"`; aggregate counters cover this app installation, including earlier saved sessions. |
| `shanbay`, `llm` | Provider objects described below. |
| `pretranslation` | Preparation-job counters for the interval. |
| `daily` | Ascending `{date, shanbay: stats, llm: stats, pretranslation}` rows. Days without records are omitted. |
| `recording` | `{available, droppedRecordsSinceStart, corruptRows}`. False means some records are missing; present totals may be partial. |

No response contains cookies, API keys, selected text or translations. Endpoint/model names can be
returned for identifying the configured personal API. Clearing a key or expiring the 30-day answer
cache does not erase numeric usage history. Uninstalling/clearing app data does erase local records.

## Shanbay account and availability

`shanbay` contains:

| Field | Meaning |
|---|---|
| `connected` | A cookie is stored. This does not verify that it is still valid. |
| `remainingPercent` | Integer 0–100 from the latest account quota query or SSE usage event, or `null`. |
| `accountUsedPercent` | `100 - remainingPercent`, or `null`. This is the account's shared balance complement, not usage attributed to this app or to the selected date interval. |
| `usageAt` | Observation time in Unix milliseconds, or `null`. Show this beside the balance. |
| `resetAt` | Server reset value as a string, or `null` when unknown. |
| `quotaScope` | `"current_session_account_shared"`; extensions and other clients can consume the same account balance. |
| `stats` | Request/cache counters across sessions on this installation during the interval. |
| `currentSessionStats` | The same counters restricted to the currently stored authentication-token scope. A changed token starts a new scope even for the same account. |
| `inFlight` | Number of this process's Shanbay requests currently running, independent of the date interval. |
| `availability` | `{analysis, translation}`, each containing `{canRequest, code, reason, blockedUntil}`. |

`blockedUntil` is Unix milliseconds or `null`. `canRequest` means a session exists and no local
cooldown currently blocks that tool; it is not a remote health check. A known analysis permission
failure can block analysis while translation remains available. A quota or authentication failure
can block both. The personal API can still handle fallback when configured.

The balance is read from the account quota endpoint and also updated by actual sentence requests.
Opening or refreshing Settings never starts a paid sentence probe. Render `null` as “未获取”, not 0%.
Do not describe a cached balance as current without its observation time.

## Request and cache counters

Both providers' `stats` contain these numeric fields:

| Field | Meaning |
|---|---|
| `requests` | Completed physical HTTP attempts recorded in the interval. In-flight attempts are separate. |
| `successes`, `failures`, `cancelled` | Outcomes of those attempts. For the personal API, success means a valid chat-completion response was received; later structured-answer validation can still reject it. |
| `cacheHits` | Answers reused from the local persistent cache. |
| `joinedRequests` | Callers that joined an existing request rather than starting another one. |
| `totalLatencyMs`, `averageLatencyMs` | Completed request duration total and integer average. Average is `null` with no completed requests. |

A batch of eight sentences is one API request. A cache hit or joined caller does not increment
`requests`. These are operational counters, not a provider invoice or a count of unique sentences.
Model-list requests and article/vocabulary downloads are outside this sentence-usage ledger.

## Personal API token counts

`llm` contains `{configured, stats, byModel, inFlight}`. `configured` only means a key is stored;
`byModel` is `[{baseUrl, model, stats}]`. Overall and per-model stats include:

| Field | Meaning |
|---|---|
| `inputTokens`, `outputTokens`, `totalTokens` | Sums of values actually returned in completion `usage`. Unknown values are `null`. Total is derived from input + output only when both are present and total was omitted. |
| `cachedInputTokens` | Provider-reported cached prompt tokens, or `null`. This is different from an app answer-cache hit. |
| `reasoningTokens` | Provider-reported reasoning tokens, or `null`. |
| `usageReports` | Attempts that supplied at least one valid input/output/total token count. |
| `missingUsageRequests` | Attempts without complete input/output/total counts, including failed attempts. |
| `tokenStatsComplete` | True only when at least one request exists and all recorded requests have complete input/output/total counts. |

Partial totals cover reported usage only. A missing `usage` object does not become zero usage.
Cached-input and reasoning tokens are subsets of input/output; do not add them to `totalTokens`.
Actual zero counts are retained as zero. Both OpenAI and DeepSeek-style usage fields are supported.
No price or monetary estimate is fabricated.

## Preparation-job counters

`pretranslation` and each daily preparation row contain:

- `runs`: finished preparation invocations, including interrupted or failed invocations.
- `completedSentences`, `cachedSentences`: served sentences and the subset served from cache.
- `shanbaySentences`, `llmSentences`: served sentences by their source, including cached answers.
- `stoppedRuns`: runs with unfinished sentences, including failed runs that left work unfinished.
- `failedRuns`: runs that threw an error; these can also count in `stoppedRuns`.

Job counters become visible when the invocation ends. Repeating preparation can increment cached
sentence counts again, so these are not unique-sentence or billable-request totals. Do not sum
`stoppedRuns` and `failedRuns` as mutually exclusive outcomes.

From 1.0.5, `analyzedSentences` counts served preloaded analyses and `cachedAnalyses` is its cached
subset. These are separate from the translation sentence counters above, and include repeat cache
reuse across invocations. A run is stopped when either translation or analysis remains incomplete.

Read on Settings entry, an explicit refresh, and after translation/preparation completes. If the
frontend polls for `inFlight`, poll only while the display is visible. Keep loading/error feedback;
retain the last snapshot when a later local read fails. See [llm-api.md](llm-api.md) for routing,
cache, cancellation and analysis, and [the authorized quota test](shanbay-quota-test-2026-11-03.md)
for the measured article cost. That external test is documented separately, not inserted into the
app's installation ledger as historical billing data.

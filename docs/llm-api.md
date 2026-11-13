Use `web/read/llm.mjs` for sentence tools and [usage-api.md](usage-api.md) for the Settings usage display.
Both use the top window's native `Llm` plugin. Cookies and API keys stay in the native vault.
The separate [DeepSeek balance API](deepseek-balance-api.md) is also ready for Settings.

```js
import { analyzeSentence, translateSentence } from './llm.mjs';
const controller = new AbortController();
const result = await analyzeSentence(selectedSentence, { signal: controller.signal });
const { translation, provider, cached } = await translateSentence(selectedSentence);
controller.abort(); // End the card's subscription on dismissal.
```

Routing is **Shanbay first, personal OpenAI-compatible API fallback**, for manual tools and automatic
pretranslation. A valid cached answer wins before another paid request, including a cached fallback
answer. No destination URL or credential is accepted by these methods from JavaScript.

## Analysis response

`Llm.analyze({text, requestId?})` returns this shape. The example is illustrative.

```json
{
  "analysis": {
    "schemaVersion": 2,
    "sentence": "While the rain fell, the children stayed inside and read.",
    "segments": [
      { "type": "clause", "text": "While the rain fell, ", "label": "状语从句" },
      { "type": "pred", "text": "the children stayed inside and read.", "label": "主干" }
    ]
  },
  "provider": "shanbay",
  "model": "扇贝",
  "cached": false,
  "fallbackReason": "",
  "remainingPercent": 84,
  "usageAt": 1793685804349,
  "expiresAt": 1796277804349
}
```

Concatenating `segments[].text` reproduces the submitted text exactly, including whitespace.
Render segments in order **without adding spaces**. Labels come from the actual provider. The
personal API's validated offsets are adapted to the same components and original whitespace.
The eight roles are `subj`, `pred`, `obj`, `clause`, `prep`, `nonpred`, `appos`, and `other`.
Unknown future Shanbay types use `other` while retaining their label. Render strings as text.
Schema 2 does not require offsets, translation, summary or grammar fields inside `analysis`.

Providers do not echo the source byte for byte, so spans are rebuilt from the sentence rather than
trusted verbatim (`SourceAlign.java`). Shanbay rewrites runs of spaces, tabs and non-breaking spaces
as one ASCII space and drops a trailing space; a model does the same and may also drop the final
period or add spacing at span edges. Whitespace and punctuation can be attached to adjacent spans,
but every word must be covered by a provider-backed grammatical role. Gaps, uncovered word tails,
and placeholder labels such as “未分析” or “其他” reject the analysis. Shanbay's `INCOMPLETE_ANALYSIS`
uses the configured personal API fallback and does not block other sentences. An incomplete fallback
fails with a retry action; it is never cached as success. Missing labels for known role types use
their Chinese names; `other` requires a specific label such as 表语 or 补语. Optional translation,
summary, structure, grammar and explanation fields may be absent. Analysis cache identities are v3
so older partial results are recomputed; translation cache identities remain v1.

The reader preserves original whitespace, attaches punctuation without separate grammar chips,
and merges adjacent pieces of the same labelled phrase without merging across punctuation.

The analysis tab appears for 10–120 whitespace tokens containing `[A-Za-z]`. Other selections up to
300 words open translation. Over-300-word or over-8,000-character input is rejected, never truncated.
Multiple selected sentences can be submitted together; the sentence methods do not split selections.

## Translation and metadata

`Llm.translate({text, requestId?})` returns `{translation, provider, model, cached, fallbackReason,
expiresAt, remainingPercent?, usageAt?, quotaResetAt?}`. Provider is `shanbay` or `llm`; model is
the actual source/model. A live fallback includes its cause. Reusing an API cache can have an empty
fallback reason because no primary attempt was made. Quota metadata is the most recent observed
account balance, not a fresh balance probe. These diagnostics belong in Settings; the analysis
and translation cards show content without source/cache/quota footers.

## Errors and cancellation

Shanbay SSE has an 8 s connection timeout, 15 s read-inactivity timeout, 45 s total deadline and
1 MiB response limit. Components/tokens are provisional until a complete `done` and validation.
Incomplete, mismatched, refused or failed answers are never cached. Uncertain billable requests are
not automatically retried. Primary quota/auth/network failures pause repeated attempts briefly;
analysis-specific permission/format failures do not disable otherwise available translation.

Adapters have a 180 s deadline for the primary-plus-fallback chain. Configuration and usage reads
time out after 15 s. Errors include `message`, optional `code` and `data.quotaResetAt`. Relevant
codes are `NO_BRIDGE`, `CANCELLED`, `INVALID_ARGUMENT`, `FALLBACK_UNAVAILABLE`, and `FALLBACK_FAILED`.
Show a retry action and the failure reason; missing fallback configuration also needs Settings.

An AbortSignal generates an ID and invokes `Llm.cancelSentence({requestId})` on cancellation/timeout.
The last subscriber's cancellation disconnects its Shanbay request. Another card/pretranslation
subscriber can keep shared work running. An already-sent fallback LLM request may finish into cache.

## Caching and pretranslation

Successful answers expire 30 days after creation; reads do not renew them. Primary entries are
scoped to the stored Shanbay login. API entries are scoped to endpoint/model/task/prompt version.
Translation keys normalize whitespace without changing case; analysis preserves exact source text.
Numeric usage history is separate from answer expiry and contains no sentence or translation text.

The reader also saves the article preparation completion marker locally until the earliest native
answer expiry. Reopening restores the ready state without starting another batch. Article, account,
model and cache-version changes invalidate this marker; incomplete results never mark an article ready.
Failed preparation remains paused across restarts until an explicit retry or a different article/configuration.

`Llm.getConfig()` includes `{has, hasShanbay, canTranslate, routing, sessionScope, baseUrl, model,
autoTranslate}`. `has` means a fallback key; `hasShanbay` means a stored cookie. `canTranslate` means
at least one source is configured, not that credentials/quota have been verified. `sessionScope`
is an opaque value for invalidating completion marks after a login change.

`Llm.setPreferences({autoTranslate})` persists the opt-in switch, initially off. App open/resume or
a date change while open loads today's article and optionally pretranslates it. Shanbay-only and
API-only configurations both work. No scheduled task runs after the app closes.

`Llm.pretranslate({sentences, includeAnalysis:true})` removes duplicates and skips cache. The
optional `includeAnalysis` defaults to true in 1.0.5. The single Settings switch prepares both
translations and analyses of 10–120-word sentences; false requests translations only. Preserve
internal sentence whitespace so a prepared analysis shares the exact reader-selection cache key.
Shanbay receives one sentence
per request. When it becomes unavailable, missing sentences use API batches of up to eight. Manual
requests join existing work. The result is `{total, completed, cached, translated, shanbay, llm,
stopped, expiresAt, fallbackReason, remainingPercent?, quotaResetAt?, analysis}`. Source counts include cached
answers served from that source. Up to 400 sentences / 250,000 input characters are accepted.

The nested `analysis` is `{included,total,completed,cached,analyzed,shanbay,llm,stopped,error,errorCode}`.
Top-level sentence counters still describe translations. Overall `stopped` is true if either task
is unfinished; `expiresAt` is the earliest served translation/analysis expiry. An analysis failure
returns partial progress and its reason while preserving usable translations. With fallback only,
analysis runs first and its embedded translation seeds the translation cache; this avoids paying
for a second completion of that sentence. Otherwise translations become available first.
Manual analysis joins the same in-flight work and reuses the same 30-day persistent cache.

`Llm.cancelPretranslation()` invalidates subsequent work. Article replacement, disabling the switch
or changing credentials also invalidate later batches. An already-sent request may complete into
cache. Completed batches survive later failure, so retries skip their work.

Network/file work runs outside Capacitor's common plugin queue. Pretranslation, cancellation and
usage reads have separate executors. See [the wire protocol](shanbay-sentence-analysis.md),
[usage API](usage-api.md), and [shanbay-api.md](shanbay-api.md).

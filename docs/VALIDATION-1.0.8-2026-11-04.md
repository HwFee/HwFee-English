# Verify quota recovery and complete sentence analysis

Install `dist/HwFee-English-1.0.8.apk` over the previous release, then use Settings → 重新读取.
Version code is 9; its certificate matches 1.0.7. No phone operations were performed.

## Quota recovery

The old button read the local ledger only. A stored zero also blocked sentence requests, leaving
the display dependent on a later successful sentence request. Settings now queries the independent
cookie-authenticated `GET https://apiv3.shanbay.com/bay-translate/quota`, discovered in the official
extension. A live read on 2026-11-04 returned HTTP 200, `remaining_percent: 100`, and
`reset_at: 2026-11-05T04:00:00+08:00`. No sentence generation or personal API request was made.

Settings entry caches successful quota reads for 60 seconds; explicit refresh bypasses that cache
and sentence cooldowns. Positive quota clears a quota block, while unrelated permission blocks
remain. Failures retain the amount and its observation time and show an error. Account switching
cannot display the previous account's response. Local usage statistics remain a separate local read.

## Complete analysis

Earlier parsers inserted source words omitted by the provider under “未分析” or “其他”, then cached
the result as success. Both providers now require every word to have a grammatical role. Shanbay
omissions trigger the configured personal API fallback without disabling other sentences. Missing
words or placeholder labels from the fallback reject the result and permit retry. This validates
coverage; it does not independently prove that a model's grammatical judgement is correct.

Analysis cache identities changed to v3 for both providers, so prior incomplete answers are
recomputed. Translation cache identities are unchanged. Whitespace differences and omitted
punctuation remain repairable without assigning invented grammar roles.

The display keeps punctuation attached to surrounding text without individual labels, merges
adjacent identical phrase labels without crossing punctuation, and preserves exact source spacing.
The fallback prompt requests specific roles for every word and discourages word-by-word fragments.

## Verification

- Web: 168 tests passed, including stale-zero refresh, failed refresh, punctuation placement,
  duplicate phrase labels, exact spacing, and rejecting cached placeholder analyses.
- Native: 147 tests, 0 failures/errors, 3 existing Windows symlink skips. Coverage includes quota
  recovery through GET only, no sentence-token spending, persistence, invalid replies, account
  isolation, permission blocks, missing words/tails, full fallback, and old-cache invalidation.
- Chromium: 326 and 390 px widths in light/dark. Exact sentence text, zero punctuation-only labels,
  no horizontal overflow. Mocked Settings moved from local 0 to remote 100 and forced a new read.
  Screenshots and measurements are under `.tmp/preview/analysis-1.0.8-*` and
  `.tmp/preview/quota-analysis-results.json`.
- Signed release built; lint reports 0 errors / 18 warnings. APK v1/v2 signatures verified, version
  and certificate checked, and all 40 packaged web assets match `web/` byte for byte.

No new live generation request was used to test the analysis fallback; provider failures and
recovery were exercised with local fixtures. Phone interaction remains unverified.

SHA-256: `7dd791650eb16b088442c0438af785bf388df302e087d985f962782fe4a18aae`.

# Validate count sources and update timing

Install `dist/HwFee-English-1.0.7.apk` over the previous release to check the phone interaction. Version code is 8; the signing certificate matches 1.0.6.

## Correct totals

The dashboard previously used translation-highlight totals as collection and mastery totals. A live, read-only call through the updated production count code returned:

| Dashboard item | Verified source | Total on 2026-11-03 |
|---|---|---|
| 生词本 | `/wordscollection/words?page=1&ipp=1` → `total` | 364 |
| 已掌握 | Current book `materialbook_id` → `learning/words/simple_learned_items?page=1&ipp=1`, decoded `total` | 79 |

已掌握 means words marked 太简单 in the current book, which Shanbay excludes from further study. The current book's studied count and the global translation-highlight count describe different scopes. Totals can change after this check.

Old persisted highlight totals have no `countsVersion: 2` marker and are discarded; the highlight cache remains usable.

## Keep numbers visible during updates

1. After confirmed add/remove, update the word highlight, retain the last official totals in memory and local storage, and immediately start a background count request.
2. Restore saved official totals synchronously before the first dashboard render. Recheck on home entry/foreground after the 60-second freshness window; manual refresh and confirmed edits bypass the window.
3. Retain totals during pending and failed requests. Ignore count responses that started before a later wordbook edit.
4. Reuse the dashboard cards and number nodes. Only changed values fade in over 220 ms; reduced-motion settings disable the animation.

## Validation

- All 162 web tests passed, including stale response races, offline reopening, old-cache migration, independent partial totals, unchanged card identity, and reduced motion.
- Android unit-test task succeeded using its up-to-date results: 141 tests, no failures/errors, 3 Windows skips.
- Release build succeeded. Android lint: 0 errors, 18 warnings.
- APK v1/v2 signatures verified, previous-release certificate matched, version code/name checked, and packaged reader files matched the source byte for byte.
- Phone interaction was not exercised; no device operation was performed. Live API verification used GET only and did not edit the collection.

SHA-256: `72636f74af9ea76ebc2261af6c8968687fb85b13d7b531ad41d759fb9fc9d2fc`

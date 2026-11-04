Install `dist/HwFee-English-1.0.5.apk`, then enable “自动预加载今日文章” in Settings to prepare both
translation and eligible sentence analysis. This signed follow-up is versionCode 6.

The existing 30-day persistent analysis cache now participates in daily preparation. Exact sentence
whitespace matches reader selections; analysis applies to 10–120 English words. Prepared answers
remain usable after process recreation. Manual analysis joins the preparation request, and both
manual tools reuse prepared answers. When the primary is unavailable, fallback analysis runs first
and supplies a translation too, avoiding another completion for that sentence. An analysis failure
preserves prepared translations and exposes partial progress; disabling preparation stops subsequent
tasks, while completed results remain cached.

The two sentence-card tabs now omit provider, cache, quota and reset-time footers, their divider,
and the short-selection analysis-range note. Errors and retry remain actionable. Quota and usage
stay in Settings. Cards estimate completed content from sentence length and width before their
first placement. They retain that side through loading, results, retries and tab changes; oversized
content scrolls within the chosen available space. Word cards first measure their loading content
before retaining a side. A card that cannot fit closes before issuing its sentence request.

Validation on 2026-11-03:

- 135 web tests passed, including loading/result placement, absent footers, exact preparation text
  and incomplete-analysis retry behavior.
- 136 native tests, 0 failures, 3 existing Windows symlink skips. New coverage includes preparation
  of both tasks, cross-recreation reuse, eligibility, shared manual requests, partial failure,
  fallback translation reuse and cancellation of subsequent work.
- Android lint: 0 errors, 19 warnings. Release build and signature verification passed; certificate
  matches 1.0.4 and supports an upgrade.
- Real Chromium checks at 390×844 and 326×740 kept loading, analysis and translation above the
  same anchor. The card's lower edge stayed at 392 px against the anchor's 400 px top; long
  responses used a 332 px scroll area and no diagnostic footer appeared. Screenshots and metrics
  remain in the user's temp directory, outside source.

No new paid-provider requests, ADB, phone installation or remote push were used for this follow-up.
The [1.0.4 live endpoint validation](VALIDATION-1.0.4-2026-11-03.md) remains the production-transport
evidence; these additions use local mocks and browser fixtures. Phone acceptance remains separate.

Artifact: `dist/HwFee-English-1.0.5.apk`, 27,453,538 bytes.
SHA-256: `58e916dfe0168abfb43f01a731619a1dfe81a590970807ed365389a81a0c3259`.
Source and decompressed release entries are checked for known credential values before delivery.

Install `dist/HwFee-English-1.0.4.apk` over the existing app, then check the reported long-idle
playback behavior on the phone. This signed build is version 1.0.4, versionCode 5.

## Real endpoint verification

The user authorized live requests and supplied a test DeepSeek key. The production Java transport
classes were called directly on 2026-11-03 at 15:32:19–15:32:28 Asia/Shanghai, using a sentence from
today's article `ufzln`. This is a live network check, separate from the local mock test suite.

| Endpoint / path | Observed result |
|---|---|
| Shanbay session, `GET /bayuser/user` | Authenticated account response returned valid JSON; identity fields were not logged. |
| Shanbay `sentence_analysis` SSE | Completed successfully: 5 components, whose texts joined to reproduce the input exactly. Usage event reported 83%. |
| Shanbay `translate_sentence` SSE | Completed successfully: 46 translation characters. Usage event reported 76%. |
| DeepSeek `GET /user/balance` | Returned a valid available CNY balance with decimal-string components. A second normal read hit the memory cache; a forced read made a new request. |
| DeepSeek `GET /models` | Returned 2 models; configured default `deepseek-flash` was present. |
| Personal LLM translation / analysis | Both completed; translation contained 39 characters, and analysis passed structural validation with 8 components and 3 grammar items. |
| Personal LLM batch pretranslation | One request returned both requested translations in input order. |

The three personal LLM completions reported 510 input + 525 output = **1,035 tokens**. The two live
balance observations did not change at the displayed cent precision; this does not establish zero
cost. Numeric-only captured usage shapes also pass through the local usage ledger test and produce
3 requests / 1,035 tokens without an additional network call. Balance/model reads do not increment
completion counters. `Llm.getUsage` is a local SQLite read, not a remote paid endpoint.

Shanbay percentages above are observations returned by two different requests. They are not exact
fractional billing measurements or proof that only this client changed the shared account balance.
The earlier whole-article test remains in [the quota report](shanbay-quota-test-2026-11-03.md).
Raw test results remain in the user's system temp directory, outside the repository.

## Playback recovery and final review

All MediaPlayer creation, calls, callbacks, seeking and release now share an audio HandlerThread,
following [Android's threading requirement](https://developer.android.com/reference/android/media/MediaPlayer).
Audio file decoding/reading and decoder Binder calls no longer execute on the UI thread. State
queries read cached values, and resuming at an unchanged speed skips playback-parameter setup.

Playback carries sentence-range parameters in the same bridge call. Transport revisions prevent
a delayed service play or focus restoration from undoing a newer pause. Snapshot sequence numbers
reject older foreground replies; repeated foreground refresh signals share a query. Reopening an
already playing lesson preserves the decoder and position. Existing background progress reporting
continues to support listening-time accounting and sentence handling.

The final review also fixed stale usage/balance results after a credential change, queued a fresh
read when a prior query is still running, exposed incomplete token reporting and local-read errors,
and removed the unverified “每日重置” quota label.

Validation: **131 web tests passed; 131 native tests, 0 failures, 3 existing Windows symlink skips**.
Android lint: 0 errors, 19 warnings. Brand-asset checks passed. The cold-resume test deliberately
blocks a decoder start and verifies that UI state reads and pause submission remain responsive.
Other regressions cover playback/focus ordering, same-speed resumes and reuse without rewinding.
These are local tests; long-idle phone behavior and the complete WeChat callback still need device
acceptance. No ADB, phone installation or phone control was performed for this release.

## Release and credential checks

The release build and signature verification passed. The certificate matches 1.0.3, so this APK can
upgrade the existing installation. All 39 packaged web files match their source, and the new native
sentence, usage, balance and audio backends are present. Release metadata is non-debuggable.

The supplied test key is stored only in a Windows current-user DPAPI-encrypted file under
`%LOCALAPPDATA%/HwFee-English/dev-secrets/`; the live cookie capture stays outside the repository.
Temporary workspace files are now ignored by Git. Known credential values and their common encoded
forms are scanned against source and decompressed APK entries before delivery. No repository push
or other remote publication was performed. Corresponding credentials were used only with the
authorized official Shanbay and DeepSeek API destinations.

Artifact: `dist/HwFee-English-1.0.4.apk`, 27,453,192 bytes.
SHA-256: `52d078738b5945e65b5003a4bbb2552383c10f21fe65d4b8cdd88ac526d4059c`.

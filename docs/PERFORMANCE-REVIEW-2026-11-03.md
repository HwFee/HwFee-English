Run `npm test` and `npm run lint:android` to verify these changes; run
`node tools/benchmark-library.mjs` to repeat the library benchmark. The user later authorized the
signed 1.0.4 release after real endpoint checks; see [the release review](VALIDATION-1.0.4-2026-11-03.md).

The review covered the native bridge queue, playback updates, library state, daily data loading,
translation concurrency and reader-card lifecycle. No imported lesson file was rewritten.

| Finding | Change | Verification |
|---|---|---|
| Every playback report reparsed progress for the whole course library | Cache parsed storage by its actual string value and read each lesson once per render | 39 lessons with 40 checkpoints each, 200 unchanged updates: 8,400 JSON parses before, 0 after. Changing one stored course reparses one record and still updates the hero. |
| Shell replaced play/pause SVG elements even when their state was unchanged | Preserve existing icon DOM until the play/pause state changes | Repeated state packets retain the same SVG node. |
| Native snapshots repeatedly included embedded base64 audio | Send a compact source identifier instead of echoing embedded bytes; use that identifier to reject obsolete document events and commands | A 2 MiB embedded source produces a state packet below 2 KiB. Legacy/system controls remain usable. |
| MediaSession metadata and media notifications rebuilt unchanged title/artwork on progress updates | Reuse unchanged metadata and notifications; keep playback state updates and immediate pause/seek/rate feedback | Progress reuses the same notification; pause updates its action immediately. Existing cover and sleep-timer tests pass. |
| ZIP import, listing and removal could hold Capacitor's common plugin queue | Move course file operations to a serial file executor; HTTP work already uses separate bounded executors | Native suite and Android compatibility lint pass. |

The captured desktop benchmark took approximately 227 ms before and 20 ms after for that specific
200-update workload. This is a jsdom CPU benchmark, not an Android frame-rate measurement or a
claim about overall phone speed.

Daily data requests now share in-flight startup work. An explicit forced refresh waits for startup
then performs one fresh fetch, even when requested twice. Concurrent full-vocabulary refreshes
also share one paginated feed. Independent learning-status and vocabulary feeds overlap while
preserving NEW-before-REVIEW output order.

Interaction and concurrency rules now covered by tests:

1. A sentence already cached uses its 30-day result. A manual translation and article pretranslation
   join the same native request regardless of which starts first. Failures are retryable and never
   become cached answers. Unicode spaces normalize identically on web and native paths.
2. Closing a card ends its subscription. A shared card/preparation subscriber can keep the request
   alive; the final subscriber's cancellation disconnects Shanbay. An already-sent fallback request
   may finish into cache. Late results cannot change a closed card or dismiss a newer card. A failed
   translation has a retry action; a missing bridge or callback cannot leave an endless skeleton.
3. Page scrolling dismisses an anchored card; scrolling inside a long card remains usable. Placement
   respects the visible viewport, keyboard, reader controls and native tab-bar reserve. Detached or
   obscured anchors close their cards. Scroll, multitouch and hiding the document cancel long press.
4. Replacing the article cancels subsequent obsolete pretranslation batches and queues the latest
   article. Changing provider/key or disabling the switch also invalidates subsequent batches. An
   HTTP request already sent may finish, and its validated answers remain cached under that provider
   and model. Cached successes survive a later batch failure.
5. Manual refresh uses the shell's existing import prompt island: progress, success, partial vocabulary
   failure, offline fallback and failure reason all have visible feedback. Existing content remains
   readable on refresh failure. Progress prompts stay until an outcome; background pretranslation
   errors wait for an active import/refresh progress prompt to finish.

The initial performance review passed 121 web tests and 90 native tests (0 failures, 3 existing
Windows skips), plus Android lint with 0 errors / 19 warnings. After the Shanbay SSE, usage and
DeepSeek balance and cold-resume additions, the full suite passes 131 web tests and 131 native tests
(0 failures, 3 skips). Android lint also passes with 0 errors / 19 warnings. The separately authorized live article quota test
is documented in [the test report](shanbay-quota-test-2026-11-03.md). No ADB or phone operations
were used for this work. Phone frame timing, thermal behavior and the full live WeChat
authorization callback remain unverified.

The LLM contract and the analysis frontend handoff are in [llm-api.md](llm-api.md).

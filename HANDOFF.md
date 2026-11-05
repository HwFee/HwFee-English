# HwFee English — handoff

One Android app for two personal tools: **cherina-pod 精听** lessons and a **扇贝阅读** daily reader.

## Playback/appearance investigation — 2026-11-04 (source, not released)

Branch `fix/playback-and-appearance` starts from main `5d5be21`. Saved/review Play
now opens the full lesson player at the saved audio time. Explicit appearance is
propagated to the shell and loaded frames, and the personal API row is centered.
Replacement imports invalidate an open player's stale timestamp table; native
seeks pause the old audio while positioning. See
[the investigation](docs/PLAYBACK-APPEARANCE-2026-11-04.md).

User clarification: bookmark replay must **not overwrite normal learning progress**.
It now uses a temporary `review=1` player document with progress/migration/resume-link
writes disabled. Normal course navigation creates a normal document and restores
the original checkpoint, including when the native decoder was playing a bookmark.

**The user's primary issue remains normal sentence-by-sentence drill overrun,
not only looping/seeking. Do not report that issue as solved by the seek fix.**
Native snapshots now preserve measured boundary overshoot separately from the
clamped UI checkpoint. The user confirms reimporting the revised ZIP and restarting
still reproduces it specifically in the second stage. A follow-up prioritizes the
drill stop over late-tick sentence resynchronisation and uses the presentation clock
only in that stage. Follow-up checks: 5 listening web tests and 31 targeted native
tests passed; see the investigation for regression evidence. No affected phone
has been tested. No release APK
has been made for this pass. Web checks (185 full-suite tests plus the new
served-player regression), 18 targeted native tests, and Chromium appearance/layout
measurements passed; all 43 Android web assets match source.

## v1.0.8 built — 2026-11-04

Install `dist/HwFee-English-1.0.8.apk` over the previous release (versionCode 9, same certificate).
Settings now queries the independent `/bay-translate/quota` endpoint even at zero, and explicit
refresh bypasses the 60-second account-query cache. A live GET returned 100% and the next reset time;
the old claim that the extension has no quota REST endpoint was incorrect and has been corrected.

The user requires complete analysis, with no “未分析” fragments. Missing provider words/tails and
placeholder roles now reject the analysis; Shanbay failure uses the configured personal API fallback.
Analysis cache identities are v3, so old incomplete results are not reused. Punctuation has no
separate chip, adjacent identical phrase labels merge, and source spacing is preserved.

Validation: 168 web tests passed; 147 native tests with 0 failures and 3 existing Windows skips;
release lint 0 errors / 18 warnings. Chromium checks at 326/390 px in light/dark passed. Signed
release verified against 1.0.7; all 40 packaged web files match source. No phone operations or live
generation requests were performed. See [validation](docs/VALIDATION-1.0.8-2026-11-04.md).

## Sentence card, usage card and analysis parsing — 2026-11-03 (source, not built)

Three reported defects fixed in source. No APK was built, so the phone keeps running 1.0.5 until
`npm run apk:release`; `npx cap sync android` has run, so `android/app/src/main/assets/public`
matches `web/`.

- **长难句分析 now survives real provider output.** Root cause: both providers were validated by
  byte-exact re-tiling of the source sentence. Shanbay normalizes whitespace in the spans it echoes
  back — double spaces, tabs and NBSP collapse to one ASCII space and a trailing space is dropped;
  measured live on this account — and a model cannot re-emit those characters either. Any sentence
  containing them therefore failed `扇贝返回的句子结果不完整或格式无效` and, after the fallback ran,
  `长难句分析结果格式无效，请重试`. Spans are now rebuilt from the source (`SourceAlign.java`): the
  provider supplies only type and label, gaps fold into the next span, a missing tail is attached,
  and a span that cannot be placed is dropped instead of failing the whole answer. The LLM path also
  accepts any markdown fence, prose around the JSON, absent `translation`/`summary`/`structure`/
  `grammar`, unknown roles (→ `other`) and a dropped final period. The reader compares segment text
  with whitespace relaxed. Only an answer with no placeable span is still rejected.
- **The sentence card's tabs stay pinned.** `.popover` is a flex column, `.pop-seg` and
  `.popover-kicker` are `flex: 0 0 auto`, and `.popover-body` owns the scroll;
  `popover.mjs::place()` caps the card with `max-height` and no longer moves scrolling onto the card.
  Neither scrollbar is drawn (`scrollbar-width: none` plus a zero-size `::-webkit-scrollbar`) and the
  body cannot scroll sideways. The analysis spans gained a dark palette: the same hue per role as a
  translucent wash, light text, and lifted 非谓语/其他 label chips.
- **The usage card's lines are single-line.** The `观测于 HH:MM` repeated under each row became one
  stamp under the title (`观测 额度 17:15 · 余额 18:07`); the row details lost their times and the
  redundant request total, and `.ua-sub`/`.ue-comp`/`.u-foot` are nowrap + ellipsis at 11.5 px. The
  footer reads `请求 146 · 缓存 102 · 预译 148 · 分析 37`.

Validation: 142 web tests and 140 native tests pass (3 existing Windows symlink skips). Browser
measurements in Chromium through the preview harness: at 326×460 the card body scrolls 61 px while
the tab's top shift is 0.00 px, the card's own `scrollTop` stays 0, and the body's scrollbar width is
0; at 326 and 390 px every usage line — stamp, quota detail, balance detail, token detail, footer —
is one line box with no clipping and no horizontal overflow, in light and dark. Live probes: 7
authorized Shanbay analysis requests (about 27 quota points, 40% → 13%) established the whitespace
normalization; private captures are not committed. The LLM-side fix is covered by local mock
fixtures only — no live paid completion was made, because the personal key is not in this checkout.

## v1.0.5 built — 2026-11-03

The user requested analysis preloading with the same opt-in switch, stable loading/result placement,
and removal of the source/cache/quota footer from both sentence-card tabs. Version is now 1.0.5,
versionCode 6. Signed artifact: `dist/HwFee-English-1.0.5.apk`; upgrade certificate matches 1.0.4.
The existing 30-day analysis cache is shared by manual and automatic work and survives
process recreation. Preparation preserves exact reader whitespace; eligible analyses are 10–120 words.
Fallback analyses seed translations, partial failures preserve completed work, and manual requests
join preparation rather than spending twice. Settings exposes the extra preparation counters.

Cards estimate completed content before choosing their side, keep that side across loading/results/
tab changes and cap long content for internal scrolling. Both successful card tabs now contain only
their content; error/retry actions remain. Settings retains quota and token reporting.

Validation: 135 web tests, 136 native tests (0 failures, 3 existing Windows skips), Android lint
0 errors / 19 warnings. Real Chromium checks at 390×844 and 326×740 preserve the same side through
loading/analysis/translation, keep the anchor clear and confirm the absent footer. No new paid API
calls or device operations were used for this follow-up. See
[the release validation](docs/VALIDATION-1.0.5-2026-11-03.md) for artifact checks and browser evidence.

## v1.0.4 built — 2026-11-03

The user authorized packaging after live endpoint checks and a final review. Signed release:
`dist/HwFee-English-1.0.4.apk` (versionCode 5), using the same certificate as 1.0.3. No device operation
or remote repository push was performed. Source changes remain uncommitted. Read
[the live checks and release review](docs/VALIDATION-1.0.4-2026-11-03.md),
[the sentence tools contract](docs/llm-api.md),
[the usage-display backend contract](docs/usage-api.md) and
[the performance and interaction review](docs/PERFORMANCE-REVIEW-2026-11-03.md) before continuing.

- Shanbay SSE is primary for analysis, manual translation AND automatic article pretranslation;
  the personal API is fallback. All share a 30-day answer cache and in-flight sentence work.
  Preparation is opt-in on app open/resume only. Shanbay sentences run sequentially; remaining
  fallback sentences can use API batches of eight. Completed work survives later failure.
- `Llm.analyze({text})` and `analyzeSentence` now drive the existing analysis UI with real schema 2
  `{sentence, segments:[{type,text,label}]}` results. Component texts reproduce the source exactly.
  SSE has bounded timeouts/size, strict completion validation, quota cooldowns and subscriber-aware
  cancellation. A shared preparation subscriber can keep work alive after a manual card closes.
- `Llm.getUsage({days:30})` and `web/read/llm.mjs::getUsage` are ready for the other model's Settings
  frontend. The local-only snapshot exposes latest account balance/time/reset, provider requests,
  cache reuse, actual reported API tokens, per-model/daily stats and preparation jobs. Unknown
  values are null, and shared account quota is not presented as app-attributed spending.
- `Llm.getDeepSeekBalance({forceRefresh:false})` and the matching web helper provide monetary
  balance for the saved official DeepSeek key. Amounts remain decimal strings; successful reads
  have a 60-second memory cache, concurrent refresh sharing, time bounds and account-change guards.
  Custom-provider keys never go to DeepSeek. This query does not change sentence/token counters.
  See [the balance contract](docs/deepseek-balance-api.md). The other model's Settings display is
  included, with credential-change guards and incomplete-usage/error feedback from final review.
- Official WeChat OAuth navigation and trusted WeChat wakeup intents are supported by the login
  WebView. Shanbay's current website redirects to QR authorization; direct native login and the
  complete phone callback have not been accepted on a device.

Playback/file operations now use one audio HandlerThread, and state queries avoid decoder Binder
calls on the UI thread. One play call carries its range; unchanged speeds skip decoder setup.
Transport revisions, focus-resume guards and snapshot sequence numbers prevent stale operations
from reversing a newer pause. Existing background progress still supports study-time accounting.
Course progress parsing, native notification rebuilds and plugin-queue blocking were also reduced.

Validation: 131 web tests pass; 131 native tests, 0 failures and 3 existing Windows skips. Android
lint: 0 errors / 19 warnings. Local fixtures remain the default test suite. Separately authorized
live checks passed Shanbay session/analysis/translation and DeepSeek balance/models/translation/
analysis/batch, consuming 1,035 reported personal-API tokens across three completions. The test key
was saved with Windows current-user DPAPI under `%LOCALAPPDATA%/HwFee-English/dev-secrets/`, outside
source and APK. Do not log credentials or push private captures. See the release review above.

The user authorized one real-account translation test of today's article: 657 words / 37 sentences,
37 successful translations in about 26 seconds, observed balance 91% → 84% (7 percentage points).
No personal API or new analysis calls were made. This is an integer observed balance change, not
exact fractional billing. See [the test report](docs/shanbay-quota-test-2026-11-03.md). Private raw
captures remain in the system temp directory and are not committed or retroactively billed into
the app's usage ledger. Phone WeChat callback and device interaction acceptance remain pending.

**Previous emulator acceptance (2026-11-02): the UI pass was verified on the API 35 emulator with
real data** (live Shanbay session, imported cherina-pod lessons, live DeepSeek translation). Uncommitted.
A second pass fixed the four phone-only defects below and was verified at the phone's own geometry.

## v1.0.3 built — further ADB work stopped at the user's request

The user resumed builds, then explicitly stopped further ADB work. Signed release:
`dist/HwFee-English-1.0.3.apk` (versionCode 4). Release build and signature verification passed.
91 web tests and 71 native tests ran (0 failures, 3 Windows skips); lint had 0 errors, 19 warnings.
Basic native playback was observed in the emulator with no WebView audio source; all 39 offline
lessons imported successfully. Full course-switch/background/PDF device acceptance was interrupted
and remains incomplete. Do not run further ADB/device operations without renewed authorization.

- The user clarified that covers belong to the **course ZIP**, not the APK. Created
  `listening/cherina-pod/dist/整库/cherina-pod-六级-39节-含封面.zip` (archived package; current delivery is in `docs/LISTENING.md`)
  from the original 39-lesson ZIP beside it. Each lesson has `images/cover.jpg` or `.webp`; player,
  lesson JSON and library paths are local. All 39 covers, index references and audio CRCs verified;
  no remote thumbnail references remain. The original ZIP is untouched. Rebuild tool:
  `tools/bundle-lesson-covers.py`. Android library metadata now resolves ZIP-relative cover paths.
- Fixed the navigation wait on iframe `load`: library/player readiness now uses usable DOM signals,
  an 8-second failed-load escape, a bounded native animation reply and web fallback. Native host
  availability is checked, and a recreated plugin resets stale hidden state. The phone reappeared
  briefly as `14a4c0bc` (PJE110), then repeatedly disconnected; no diagnostic APK was installed.
- The handout button is now `存为 PDF`. `handout-shim.js` preserves dictation and selected-range
  DOM state, excludes controls/scripts, and calls a native `HandoutPdfExporter` that uses Android's
  print-to-PDF UI with a dedicated WebView. It compiles; end-to-end PDF export remains unverified.
- The user rejected repeated decoder recovery interruptions. `NativeAudioEngine` now implements
  native MediaPlayer decoding, foreground/media-session controls, audio focus, rate/seek and native
  sentence/part boundaries. `native-audio.js` adapts the generated player's audio API without giving
  the WebView an audio source. Android native playback does not use the old reload/retry loop.
  This backend compiles and basic emulator playback worked; do not claim interruption-free phone acceptance.
- Progress now lives in `cherina-lesson:<imported-id>.parts[segment]`, including current stage,
  sentence, second, speed and per-stage checkpoints. It flushes before a course switch and at most
  one second between time updates. Same-segment hash navigation no longer resets the stage; hidden
  native playback saves the actual sentence at its current time. Completion is not required to save.

Final source corrections refreshed artwork metadata when reusing a decoder and prevented a stale
playing packet from reversing an optimistic pause. Release was rebuilt from the latest web/native
sources and copied to the dist path above after device work stopped.

## Playback and live state follow-up — 2026-11-02, v1.0.2

- Import, reader refresh and the native switcher now share one Compose animation. The shell waits
  for its completion before revealing a player, reader or handout; quick back cancels pending navigation.
- Served lesson payloads use their imported directory as the progress identity. Existing progress
  migrates once, and four/six-level versions then save independently. Both home cards follow the
  current lesson/article, including segment, stage, pause and reading progress, without reloading.
- The background audio failure was reproduced on the emulator: `PIPELINE_ERROR_DECODE`, media error
  code 3, while the same local audio returned HTTP 206. The shim catches swallowed play rejections,
  preserves playback intent/position/speed across recovery and reload, and cancels obsolete retries
  when playback succeeds. The final build played from about 3 s to 66.7 s while hidden, without an
  error or warning. The user's phone still needs the updated APK for its own ROM-specific check.
- System playback controls now target `playerFrame`. Album art reaches MediaSession metadata and
  the notification, with bounded loading, offline caching and protection against late old covers.
  Verified in the actual system media card, including native pause/play commands.
- Listening time now follows audio progress rather than animation frames. Pauses/seeks/stalls do
  not count; speed uses real seconds, midnight splits across days, and completions are deduplicated.
  The existing streak rule remains 120 seconds OR a completed segment per day, with yesterday's
  streak retained until today qualifies. Historical records are kept; previously lost time cannot
  be reconstructed reliably.

Validation: 80 web tests passed; 69 native tests, 0 failures and 3 Windows symlink skips. Android
lint: 0 errors, 18 warnings. Signed release: `dist/HwFee-English-1.0.2.apk` (versionCode 3); its
packaged player shim matches the source. No imported lesson file was rewritten.

## Phone fixes — 2026-11-02

Measured on the user's phone screenshot (1264×2780 at 620 dpi → **326 CSS px** in the WebView), then
reproduced on the emulator with `wm size 1264x2780` + `wm density 620`.

- **Transport is centred again.** `.ctl` used `1fr auto auto auto 1fr`; a `1fr` track is floored at
  min-content, and the 46 px speed pill is wider than its half, so both tracks took their own floor
  (46 and 42) and the grid overflowed 30 px — the play button sat **15 px right of the card's
  centre**. Injected `.dock .ctl{grid-template-columns:minmax(0,1fr) auto auto auto minmax(0,1fr)}`
  plus width caps on the pill and the loop button. Play centre now equals card centre exactly.
- **The dock clears the gesture bar.** The WebView is only inset below the status bar
  (`GlassHost` uses `statusBarsPadding()`), so `env(safe-area-inset-bottom)` is 0 and the card's
  bottom edge landed 2 px above the gesture pill. `TabBar.getMetrics` now also returns `navInset`
  (CSS px); the shell publishes it as `--hwfee-nav-inset` and mirrors it into both iframes; the
  injected player CSS adds it to `.dock`, `.side-b` and `.sheet` bottom padding. The card sits 12 px
  above the gesture area.
- **The 四方块 button leaves the lesson for the app library.** `player.html`'s `#bHome` is an
  `<a href="../index.html">`, which inside `/lessons/<id>/` is the template's own page. The shim
  rewrites it to `/listen/library.html`; the tab bar comes back.
- **Playback resumes at the second, not just the sentence.** `player-shim.js` stores
  `{i, t}` per lesson path (`hwfee:pos:<path>`) on `timeupdate`/`seeked`/`pause`/`pagehide` and,
  after the page's own `loadedmetadata` handler puts the cursor at the sentence start, seeks back
  into it. Verified: pause at 250 s, reload, audio reopens at 250 s.
- **Counts no longer inherit the six-hour feed cache.** The expensive highlight feed stays cached;
  the numbers are re-read from one `ipp=1` metadata page per category (`fetchLiveVocabCounts`,
  60 s throttle, in-flight dedupe) whenever 词间 renders or the app regains focus. A partial or
  failed answer keeps the cached number — it never prints 0. Verified by seeding a stale
  `wordbook: 999` into the cache: the tile still shows the live 225, and 已掌握 524 not the stale 534.
- **The tab bar is reachable mid-lesson.** It used to hide inside the player, which left no route to
  阅读/设置 until the lesson was finished. `pushTabBarState` now always sends `hidden: false`; the
  player's dock, transcript sheet and translation sheet clear `max(--island-reserve,
  --hwfee-nav-inset)`, so the card floats above the glass bar instead of under it. Verified: start
  audio, tap 阅读, come back — same player, audio kept running (410 s → 430 s while hidden).
- **Stages cannot be skipped.** Every step chip was freely tappable, so 盲听 could jump straight into
  对照. The shim gates the chips in the capture phase (clicks and keys 1–4): a stage opens only if it
  has been reached — `max(current, furthest completed − 1)` — locked chips are dimmed, and a tap
  answers `先听完这一段` under the bar. Verified: fresh lesson locks 精听/对照/再盲听 and the click
  does not move the pill; a segment with `steps[n] = 4` unlocks all four.
- **Back keeps the lesson playing.** The player moved into its own frame (`#playerFrame`) instead of
  navigating the library frame. 四方块 and Android back now only hide it, so audio keeps running while
  the library is browsed; the playing lesson's card (hero kicker and grid button) reads `正在播放`
  (or 已暂停) and tapping it returns to the same player document at the same second. Verified:
  6.4 s → 9.6 s while the library was on screen, then the same audio resumed at 18 s.
- **Manual wordbook edits survive the lagging feed.** `user_vocabs` still reports the state before a
  write for a request or two, and the forced refetch after 加入/移出 replaced the tint that had just
  been applied (a today-word went blue for a second and then lost it). `patchWordbook` now records a
  ten-minute override that wins over feed and cache payloads until the server agrees. Verified live:
  `clinging` keeps `hl-wordbook hl-today` at 0.9 s and at 5 s after 加入, and drops the wordbook
  class after 移出.
- **The playing card shows pause, not words.** The hero's round button swaps to a pause glyph while
  its lesson plays and back to play when paused; tapping it toggles playback, the rest of the card
  still opens the player. No text change on the cards.
- **The island collapses inside a player again** (like the import button), and the lesson opens only
  after its page has loaded, so the swap no longer flashes white.
- **A handout owns both ends of the screen, like a player.** The island and the import button
  collapse together (one `is-immersive` toggle drives both, so they cannot drift apart); the back
  button is back at the top-left as the reader's glass circle, and the print controls sit in a
  wrapped glass card at the bottom instead of a horizontal scroller.
  Verified: `immersive` and the import opacity flip together on the way in and out, the rail wraps
  to two rows (88 px) above the gesture bar.
- **A dead media pipeline repairs itself.** Chromium drops the decoder while the app is in the
  background, the `<audio>` fires `error`, and cherina-pod paints 找不到音频 over a silent player.
  The shim rebuilds the pipeline at the same second, hides the warning and resumes if it was
  playing. Retries back off (0.3 / 1.2 / 3 / 8 s), returning to the foreground retries again with a
  fresh budget, and when the in-page attempts are used up the shell reloads the player document
  (capped at two per lesson) so the audio request runs through a clean pipeline. Every failure is
  recorded in `localStorage['hwfee:audio-errors']` (code, message, src, readyState, visibility) —
  the phone has not reproduced it on the emulator (75 s screen-off background kept playing), so
  that record is how the next report gets a cause instead of a guess.
- **Tab switches no longer re-raster the whole WebView.** Panes go `visibility: hidden` instead of
  `display: none`, so a hidden iframe keeps its compositor layer and revealing it does not repaint
  the page (that repaint was the flash).
- **The library is wired even when it loads before the shell module.** A cold start can finish
  `listenFrame` before `shell.js` runs; the load event is then already gone and the first tap used to
  open the player inside the library frame. The wiring now also runs immediately when the document
  is already `complete`.

Validation: 69 Node tests, 65 native JVM/Robolectric tests (including `LessonServerInjectionTest`),
signed release APK builds with the same certificate. `--hwfee-nav-inset` is the only new seam between
native and web; it is optional and defaults to 0 outside the shell.

## UI pass — 2026-11-02

- **One visual system.** Shell, 词间 and 设置 moved from the warm paper palette to cherina-pod's
  tokens, including its dark branch. Bundled fonts: Noto Sans SC (UI) and Literata (reader body).
- **Native liquid-glass tab bar** (精听 / 阅读 / 设置) drawn over the WebView with
  `io.github.kyant0:backdrop` 2.0.1, ported from Kyant's catalog `LiquidBottomTabs`. Press-to-grow,
  drag between tabs, and refraction of the page behind it all work. It stays available inside a
  lesson player (the player's dock clears its footprint), so 阅读/设置 are one tap away mid-lesson.
  The 阅读 unread dot and its state tracking were removed at the user's request. The toolchain moved to AGP 9.1.1 / Gradle 9.3.1 /
  compileSdk 37 for it; targetSdk is unchanged.
- **词间 home** mirrors the 精听 library: date + refresh, 我的精读, four tiles (今日新词, 复习, 生词本,
  已掌握), today's article card with its real square cover, and 近几篇 from the local archive.
- **Reader**: full-bleed, serif body, back + font-size controls, 生词本 words tinted blue, 今日学习
  words underlined orange, a per-article legend with counts. Long-press translation and tap-a-word
  open anchored paper cards (design A in `designs/word-card/`) that never cover the pressed sentence
  or word. The word card shows US phonetics, a speaker for Shanbay's audio, aligned senses and one
  `加入生词本` / `移出生词本` button; its status line is reconciled with `words_check`. A 404 from
  Shanbay (`NOT_FOUND`) means the dictionary has no entry.
- **Reading states** 待读 / 在读 N% / 已读 live in `web/read/reading-state.mjs` (localStorage
  `hwfee:read:progress`): opening marks 在读 and saves the paragraph position for resume, reaching
  the end marks 已读, long-pressing a card toggles 已读 / 未读.
- **Icons** are Phosphor (MIT) everywhere outside cherina-pod's pages: `web/icons/icons.mjs` for the
  web, fill paths in `GlassTabBar.kt` for the native bar, filled glyph on the selected tab.
- **Toasts** are a Dynamic-Island-style dark capsule dropping from the top centre: `toast(msg, {kind,
  detail, ms})` in `web/shell.js` with progress / success / error / info marks (`window.hwfeeToast`).
- **Floating buttons never cover content.** The 阅读 refresh button is in-flow; the import button on
  精听 fades out once the library scrolls (`is-scrolled`). The read-home hero adapts below 520px so
  the title wraps whole words.
- **Compact word card** (≤280px): at most 2 senses, each truncated to 3 meanings, `全部释义` / `收起`
  expands in place. A Shanbay 404 (`NOT_FOUND`) renders as "词典里没有这个词".
- **Archived covers repair automatically.** Opening or refreshing the reader online backfills missing
  cover URLs for the ten visible recent articles, including entries saved before thumbnail support.
  The repair runs in the background, preserves saved text, and retries after a failed request on a
  later refresh. The November 1 card now shows its real photo after upgrading the emulator.
- **设置** is a tab: large title, cards, destructive actions ask for confirmation.
- **Android back**: closes a popover, leaves the reader, leaves a lesson player, returns to 精听,
  then backgrounds the app (audio keeps playing).
- The cherina-pod library's letter-over-cover bug and its bottom padding are fixed by
  `LessonServer.injectLibraryFixes` at serve time; `web/listen/*` is byte-identical.
- `handout.html` (讲义) is injected at serve time (`LessonServer.injectHandoutFixes`): phone
  margins, readable type, a scrollable notes table, tab-bar clearance, and a floating back
  circle that falls back to the library. Android back returns to the library via
  `hwfeeBack` (any non-library listen page goes `history.back()`).

Validation: 52 Node tests pass; the native suite has 46 passes and three Windows symlink skips.
Debug and signed release APKs build (≈31 MB debug, ≈27.5 MB release, mostly fonts); release signature
verification and release lint checks pass. All 24 packaged web files match `web/`, and the release
includes the ARM64 native library. The screenshot set is in `.tmp/shots/` (`sheet-light.png`,
`sheet-dark.png`); the repaired card is in `cover-fixed-light.png` and `cover-fixed-dark.png`.

Not verified: a side-by-side with Coolapk (it is arm64-only and crashes on the x86_64 emulator), a
real phone, and installing the new signed release APK on a phone.

The backend section below describes the earlier reliability pass.

## Backend continuation — 2026-11-01

User preference: assign small, bounded tasks to **GPT-6 Luna** subagents. The lead owns the main
backend implementation, review, and integration. This continuation used that split.

- **Imports preserve existing lessons.** Extraction streams under a 2 GiB total / 512 MiB per-file
  limit, reserves 32 MiB of free storage, and bounds entry count and nesting. Both folder and
  self-contained HTML layouts still work. Metadata is prepared before publishing; replacements
  retain a backup until the new directory is installed. Failed publication rolls back, and startup
  recovers interrupted replacements and clears abandoned staging directories. Dot-only IDs cannot
  address the library root or app files.
- **Lesson deletion and serving stay inside the library.** Removal validates a direct lesson ID
  and does not recurse through symlinks. Serving preserves literal `+` and `%` filenames, checks
  canonical containment including directory-default `player.html`, safely embeds metadata JSON,
  and ignores unsupported multi-range requests instead of returning a false 416.
- **Translation has a tested success path.** Native `LlmClient` applies defaults, bounds responses,
  refuses redirects, closes failed connections, and handles malformed/empty/truncated/refused
  provider replies without exposing keys or provider error bodies. Android config requires HTTPS.
  Omitted settings preserve saved values; blank base/model fields explicitly restore defaults.
  The success path uses a local mock provider; a real paid-provider key is still required for live
  confirmation.
- **Shanbay failures have stable codes.** `ShanbayClient` validates cookie headers and relative
  paths, keeps the production origin fixed, closes connections, bounds response size, and preserves
  DELETE bodies and 204 responses. HTTP redirects are blocked. Authentication errors remain visible.
- **Offline reading now works.** A validated last successful article and learning-count snapshot
  can be loaded after a network failure, retaining its original date and marked `离线缓存`.
  Authentication and data-readiness errors do not silently become offline results. The optional
  matching-article source still falls back to the latest article when no match is ready.
- **Vocabulary refreshes publish only complete results.** Pagination no longer stops at six pages;
  partial failures retain the previous complete cache. Cached entries are validated, duplicate word
  and inflection masks are merged, and both wordbook additions and removals refresh highlights.
- **Playback lifecycle is corrected.** Idle page reports and idle sleep requests cannot create a
  foreground playback session. Explicit Play is idempotent, Stop pauses the WebView, and a new play
  report can restore a stopped service. Notifications support API 23. A bounded partial wake lock
  keeps a pending sleep timer on time with the screen off, and is released on expiry, cancellation,
  or service destruction. An empty service restart is not sticky.
- **Login state is truthful.** Undecryptable restored secrets are not reported as connected. A
  cancelled login cannot save a late authentication result; failed probes can retry, and redirect
  responses cannot masquerade as authenticated success.
- **Builds are portable.** Java 21 comes from the local environment instead of a committed Windows
  path. `npm test` runs the Node data-layer tests and native/Robolectric tests; see `docs/DEV.md`.

Validation: **48 native JVM/Robolectric tests and 16 Node tests pass**, with no skipped tests.
Android lint passes with **zero errors and 16 nonblocking warnings** (template assets, dependency
update suggestions, required WebView JavaScript, and storage API advice). The debug APK builds,
its signature verifies, and all 20 packaged web files match `web/` exactly. The existing device-test
source also compiles, with its scaffold package assertion corrected to `com.hwfee.english`.

Artifact: `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed, 4.0 MiB).
SHA-256: `3186c924e8f0e0f188e42856fcc02f254149539bcd0908be81fa28994c5cb2a1`.
Backend continuation branch: `backend/reliability`.

No Shanbay session, live LLM key, release signing key, or attached device is available in this
checkout. Real-phone background audio/lock-screen behavior, live translation, and a signed release
upgrade remain verification steps. The debug APK does not use the existing release signing key.

---

## What works today

Everything below was verified on an Android 15 emulator (x86_64, API 35) through Chrome DevTools Protocol, not by eye. See `docs/DEV.md` for the harness.

### Listen tab

- **Import a lesson zip** two ways: the ⤓ button in the tab bar (system file picker), or sharing a `.zip` into the app from another app.
- **Both shapes cherina-pod ships are accepted**: the folder form (`cet4/<slug>/player.html` + `audio/episode.mp4`) and the self-contained single-file form (5–10 MB `.html` with audio inlined). Verified with 2 folder lessons and 11 single-file lessons.
- The library page is cherina-pod's own `index.html`; the lesson index is injected into its `__DATA__` token at serve time, so the page's code is untouched.
- The player is cherina-pod's own `player.html`, also untouched on disk — a small shim is injected before `</body>` on the way out.
- **Audio seeks correctly** (`duration 515.178`, seek to 300 s lands exactly) because `LessonServer` answers HTTP `Range` requests itself.
- **Background playback works**: 8 s of audio advanced while the app was backgrounded, held by a foreground service with a MediaSession.
- **Lock-screen transport works**: `KEYCODE_MEDIA_PAUSE` paused the player through the MediaSession.
- **Sleep timer works**: a 9-second timer paused playback at 9 seconds.
- Every lesson is served from the app origin (`https://localhost/lessons/<id>/…`), so `cherina-pod:activity` (streak) and `cherina-pod:saved` (review schedule) are shared across lessons instead of resetting per `file://` file.

### Read tab

- **Daily refresh on the phone**: today's word counts and today's article fetched through a native bridge. Live result: `新词 45/45 · 复习 135/135 · 已完成` and the day's article with 25 paragraphs.
- **Long-press a sentence** opens a translation sheet. The path is verified end to end up to the network call — an invalid key produces `翻译密钥无效，请在设置里更新`; a real translation needs a real key in 设置.
- **Tap a word** opens a card with part of speech and meaning (`n. 麻烦事，讨厌的人（或东西），妨害行为`), plus a wordbook button whose label reflects true membership. Adding and removing were both round-tripped against the live account.
- **Highlighting** matches your own vocabulary, inflections included: 680 word spans, 37 sentences, 37 today-words (dotted) and 9 wordbook words (amber) on the current article, built from 7,919 entries.

### Settings

- Connect Shanbay by **in-app web login** or by pasting a cURL / `Cookie` header.
- LLM key, base URL and model, stored in the Keystore.
- Live state: 已连接扇贝 · 13 节课 · 共 80 段.

---

## Repo layout

```
HwFee-English/
  PLAN.md                  the agreed plan and decisions
  HANDOFF.md               this file
  docs/
    DEV.md                 build / emulator / CDP workflow
    shanbay-api.md          reverse-engineered endpoint map (verified parts marked)
  web/                     what the WebView loads — single origin
    index.html shell.css shell.js     tab bar, import, settings
    listen/                vendored cherina-pod templates + shim
    read/                  the reader: index.html, app.js, exercises + data layer
  android/                 Capacitor Android project
    app/src/main/java/com/hwfee/english/
      MainActivity.java        plugin registration, share-intent intake, webview client
      LessonStore.java         unzip, lesson discovery, metadata, library index
      LessonServer.java        /lessons/ serving with Range, library + player injection
      LessonWebViewClient.java one place where those two routes hook into Capacitor
      LessonsPlugin.java       import / list / remove
      ShanbayPlugin.java       cookie-authed HTTP against apiv3
      LlmPlugin.java           vault/config bridge for OpenAI-compatible translation
      LlmClient.java           bounded, tested translation transport
      ShanbayClient.java       bounded, tested cookie-authenticated transport
      LessonArchive.java       streaming ZIP extraction with limits
      LessonInstaller.java     publish / rollback / interrupted-import recovery
      LessonPath.java          safe lesson IDs and recursive removal
      LessonRequestSupport.java path, range and embedded JSON helpers
      AudioPlugin.java         foreground service control
      PlaybackService.java     MediaSession + notification + sleep timer
      AudioBridge.java         the line between service and WebView
      LoginActivity.java       in-app Shanbay login and cookie capture
      Vault.java               Android Keystore (AES-GCM) secret storage
  tools/
    sync-web.ps1           copies the two source projects' UI into web/
    invoke.mjs             evaluates JS in the running app over CDP
```

The listening source now lives in `listening/cherina-pod`; `tools/sync-web.ps1` uses that local path. The reader source remains `Desktop\扇贝阅读助手`. The APK serves vendored files and imported lessons. Course migration, unified packaging and progress compatibility are documented in `docs/LISTENING.md`.

---

## Build, run, verify

```powershell
pwsh -File tools\sync-web.ps1     # only when a source project changed
npx cap sync android
npm run apk                       # -> android\app\build\outputs\apk\debug\app-debug.apk
```

Release build:

```powershell
npm run apk:release               # signed, uses android\keystore.properties
```

`docs/DEV.md` has the emulator boot command, install/launch, the CDP attach (`adb forward` + `tools\invoke.mjs`) and the screenshot commands. Read it before the UI pass — it is how every claim in this file was checked.

---

## Secrets — and what is deliberately not in this repo

| Secret | Where it lives |
|---|---|
| Shanbay session cookie | Android Keystore, AES-GCM, alias `hwfee.vault.v1` |
| LLM API key | same Keystore vault, entered in 设置 |
| Release signing key | `android/hwfee-release.jks` + `android/keystore.properties` — **both gitignored** |

**Keep those two signing files safe.** Lose them and future builds cannot be installed over the app already on the phone without uninstalling it first.

The release certificate is `CN=HwFee English, OU=Personal, O=HwFee, C=CN`, SHA-256 fingerprint `ab63a748ce01b01e3e20e6f4a56abf1ab1bd4944855900aa0c53d853a17eb58c`. A signed release APK builds today (3.2 MB at `android/app/build/outputs/apk/release/`).

No secret is committed.

---

## API surface (what the UI pass can call)

| Plugin | Methods |
|---|---|
| `Lessons` | `importZip()` (picker), `consumeShared()`, `list()` → `{data: JSON string}`, `remove({id})`, `importPath({path})` (debug only) |
| `Shanbay` | `login()` → `{connected}`, `setCookie({cookie})`, `hasCookie()` → `{has}`, `clearCookie()`, `request({path, method, body})` → `{body: string}` |
| `Llm` | `setConfig({key?, baseUrl?, model?})`, `getConfig()` → `{has, baseUrl, model, autoTranslate}`, `clearConfig()`, `translate({text})` → `{translation, model, cached}`, `analyze({text})` → `{analysis, model, cached}`, `setPreferences({autoTranslate})`, `pretranslate({sentences})`, `cancelPretranslation()` — see `docs/llm-api.md` |
| `Audio` | `start({title, artist, duration})`, `state({playing, position, duration, title, artist})`, `stop()`, `sleep({minutes})` — minutes may be fractional |

JS modules in `web/read/`:

- `bridge.mjs` — `loadState()`, `hasSession()`, `cachedArticles()` (unused so far: the article history view)
- `gestures.mjs` — `decorate(root)`, `initGestures(root)`, `loadHighlightVocab()`, `setHighlightCategories([...])` (the last one is unused: highlight category toggles)
- `sheet.mjs` — `openSheet({kicker, title, content, actions})`, `closeSheet()`, `line()`, `spinner()`

---

## What is left

1. **A check on a real phone** — lock-screen behaviour, background audio, and the glass bar next to Coolapk's are the things an emulator cannot judge honestly.
2. **A signed release build** on the AGP 9 toolchain (R8 now uses `proguard-android-optimize.txt`).
3. **App icon and splash** — currently Capacitor defaults.
4. Optional, backend already exists with no UI: remove-a-lesson, highlight category toggles (`setHighlightCategories`).

---

## Known limitations and risks

1. **The Shanbay API is unofficial.** It can change without notice. All calls sit behind one plugin and one module, so a break is local to `ShanbayPlugin` / `web/read/bridge.mjs`. The paste-a-cURL fallback stays for exactly this reason.
2. **Background audio with a WebView depends on the ROM.** It works with the foreground service on the A15 emulator. If a specific device still pauses it, the fallback is driving audio with ExoPlayer behind the same UI — that was an explicitly rejected option, so it would be a decision, not a refactor.
3. **One lesson's audio fails to decode at 68.8 s** on the emulator (`PIPELINE_ERROR_DECODE`), which froze playback and briefly looked like a backgrounding bug. Range serving was correct throughout; it reads as an emulator codec limitation, but it has not been reproduced on real hardware.
4. **Cookie capture had a real trap**: Shanbay sets an `auth_token`-shaped cookie *before* any credentials are entered, so the first implementation "succeeded" in 2 s on a guest token. Capture now verifies against `/bayuser/user` and refuses to overwrite a working session with an unproven one.
5. **Live translation still needs a real key.** Mock-provider success, malformed responses, timeouts,
   and failure mapping are covered by automated tests; no live paid-provider call was made here.

---

## Decisions worth not re-litigating

- **Capacitor shell + native plugins, not a native rewrite.** Both UIs survive nearly verbatim; the native layer exists where a WebView cannot go.
- **One origin for everything.** Lessons, shell and reader all load from `https://localhost`, which is what makes the shared localStorage (streak, saved words) work.
- **Shanbay-first sentence tools.** Manual translation, analysis and opt-in preparation use Shanbay SSE first; a personal OpenAI-compatible API is fallback. Shared 30-day caches avoid repeat requests.
- **Cookie and LLM key are never returned to the WebView.** HTTP happens in native Java, with the secrets read from the Keystore at call time.
- **Lesson files on disk are never modified.** Library data and the playback shim are injected while serving.
- **Wordbook writes need `business_id: 1`.** Without it `/wordscollection/words` returns HTTP 400.
- **Iframe plugin calls must go through `window.top.Capacitor`.** An iframe receives its own injected bridge whose calls never resolve — this cost an afternoon once and is worth remembering.
- **`cet4/` and `cet6/` carry the same lesson id**, so the imported id comes from the path and the level goes into the title.

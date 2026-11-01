# HwFee English — handoff

One Android app for two personal tools: **cherina-pod 精听** lessons and a **扇贝阅读** daily reader.

**Current state (2026-11-01): the backend reliability pass is implemented and host-tested.**
The UI/UX pass is still the next product task. The original Android 15 observations below describe
the baseline commit `08c152e`; this continuation does not claim a new emulator or phone run.

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
    shots/                 screenshots of the current (pre-redesign) UI
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

The two source projects (`Desktop\English-listening\cherina-pod`, `Desktop\扇贝阅读助手`) are **vendored, not linked**: `tools/sync-web.ps1` refreshes `web/listen/` and the reader's data layer on demand. The app never builds against those repos at runtime.

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

No secret is committed. The screenshots under `docs/shots/` contain only public article text and the current empty settings fields.

---

## API surface (what the UI pass can call)

| Plugin | Methods |
|---|---|
| `Lessons` | `importZip()` (picker), `consumeShared()`, `list()` → `{data: JSON string}`, `remove({id})`, `importPath({path})` (debug only) |
| `Shanbay` | `login()` → `{connected}`, `setCookie({cookie})`, `hasCookie()` → `{has}`, `clearCookie()`, `request({path, method, body})` → `{body: string}` |
| `Llm` | `setConfig({key?, baseUrl?, model?})`, `getConfig()` → `{has, baseUrl, model}`, `clearConfig()`, `translate({text})` → `{translation}` |
| `Audio` | `start({title, artist, duration})`, `state({playing, position, duration, title, artist})`, `stop()`, `sleep({minutes})` — minutes may be fractional |

JS modules in `web/read/`:

- `bridge.mjs` — `loadState()`, `hasSession()`, `cachedArticles()` (unused so far: the article history view)
- `gestures.mjs` — `decorate(root)`, `initGestures(root)`, `loadHighlightVocab()`, `setHighlightCategories([...])` (the last one is unused: highlight category toggles)
- `sheet.mjs` — `openSheet({kicker, title, content, actions})`, `closeSheet()`, `line()`, `spinner()`

---

## What is left

1. **UI/UX pass** — three surfaces, all already behind working plumbing:
   - the listen library (cherina-pod's own page today),
   - the reading page plus its two bottom sheets (word card, translation),
   - settings.
2. **A real LLM key** in 设置 — long-press translation stops at the verified-key check until then.
3. **A check on a real phone** — lock-screen behaviour and background audio are the two things an emulator cannot judge honestly.
4. **App icon and splash** — currently Capacitor defaults.
5. Optional, backend already exists with no UI: remove-a-lesson, article history (`cachedArticles`), highlight category toggles (`setHighlightCategories`).

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
- **No Shanbay translate service.** It is metered (`remaining_percent`, `quota_exceeded`) and VIP-gated (`403`); the app uses a personal OpenAI-compatible key instead.
- **Cookie and LLM key are never returned to the WebView.** HTTP happens in native Java, with the secrets read from the Keystore at call time.
- **Lesson files on disk are never modified.** Library data and the playback shim are injected while serving.
- **Wordbook writes need `business_id: 1`.** Without it `/wordscollection/words` returns HTTP 400.
- **Iframe plugin calls must go through `window.top.Capacitor`.** An iframe receives its own injected bridge whose calls never resolve — this cost an afternoon once and is worth remembering.
- **`cet4/` and `cet6/` carry the same lesson id**, so the imported id comes from the path and the level goes into the title.

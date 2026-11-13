# HwFee English — Current Status & Handoff

> Historical release notes (`v1.0.0` – `v1.0.12-v7`) live in [docs/CHANGELOG.md](docs/CHANGELOG.md). Project overview, directory layout, and settled architecture decisions live in [README.md](README.md).

## Current baseline (`v1.0.12-v7`, `versionCode 13`)

- **Automated verification**: `npm test` passes **267** Web tests (`node --test`) and **185** Android JVM/Robolectric tests (plus **3** symlink tests skipped on Windows). Android Lint reports **0 errors / 15 warnings**.
- **Release packaging**: signed APK enables R8 full mode and resource shrinking (`res/raw/keep.xml` retains Cordova's runtime `config.xml`), with debug-only Compose previews excluded via `src/debug`.
- **Delivered features**:
  - **Listen (精听)**: offline ZIP/SAF/`content://` import, immutable on-disk course storage with serve-time `LessonServer` injection, native `PcmSentence`/`SentenceClip` bounded WAV decoding for stage-2 drill and loops, whole-file `NativeAudioEngine` + `PlaybackService` (`MediaSession`) for blind/compare/continuous sleep playback (preserving normal checkpoints), in-library bookmark review, course delete, and `存为 PDF` handout printing.
  - **Read (精读)**: cookie-authed Shanbay sync (`词汇高亮`、`生词本`、`已掌握`、`近几篇`、`阅读状态`) with official counts (`countsVersion: 2`), extension-aligned highlight revalidation + manual **刷新高亮**, word lookup & wordbook edits, and long-press sentence popover (**长难句分析** + **翻译**, Shanbay SSE primary / personal LLM fallback, shared 30-day cache & opt-in preloading).
  - **Shell & Settings**: Compose liquid-glass bottom bar (`TabBar`), floating mini-player, explicit `系统 / 浅色 / 深色` appearance sync across frames, `LoginActivity` / cURL cookie capture, Android Keystore vault, DeepSeek balance, Shanbay quota refresh, local 30-day usage ledger, and uniform `PasswordDots.woff2` password masking.

## Native bridge surface

| Plugin | Exposed `@PluginMethod`s |
|---|---|
| `Lessons` | `importZip`, `consumeShared`, `importPath` (debug only), `list`, `remove`, `saveHandoutPdf` |
| `Shanbay` | `login`, `setCookie`, `hasCookie`, `clearCookie`, `request` |
| `Llm` | `setConfig`, `getConfig`, `clearConfig`, `listModels`, `translate`, `analyze`, `cancelSentence`, `setPreferences`, `pretranslate`, `cancelPretranslation`, `getUsage`, `getShanbayQuota`, `getDeepSeekBalance` |
| `Audio` | `nativePrepare`, `nativeControl`, `start`, `state`, `stop`, `sleep` |
| `TabBar` | `setState`, `getAppearance`, `setAppearance`, `getMetrics` |

Unused UI surface still present in JS: `web/read/gestures.mjs::setHighlightCategories` (no dedicated highlight-category toggle UI).

## Pending real-device verification

Emulator and Chromium checks cannot prove real-phone hardware/ROM behavior. The following remain to be confirmed on a physical phone (always ask user authorization before running `adb` against a physical device):

1. **Real-phone audio & sleep behavior**: long-idle background playback, lock-screen `MediaSession` controls, speaker/Bluetooth stopping latency on `PcmSentence` clips, continuous sleep timer expiry under doze, and listening spot-checks on the 1,338 unified captions flagged with `< 0.2` Wav2Vec2 confidence (see [docs/LISTENING.md](docs/LISTENING.md)).
2. **Visual glass bar parity**: side-by-side comparison of `GlassTabBar` against Coolapk (`base.apk` is arm64-only and crashes on x86_64 emulators).
3. **Interactive device flows**: end-to-end WeChat OAuth wakeup callback inside `LoginActivity`, real paid LLM key round-trip in Settings, `HandoutPdfExporter` print-to-PDF interaction, and reproducing/closing any device-specific force-stop or highlight edge cases.

## Secrets & release signing

| Secret / material | Location |
|---|---|
| Shanbay session cookie | Android Keystore (`AES-GCM`, alias `hwfee.vault.v1`) via `Vault.java` |
| Personal LLM API key | Same Keystore vault; never returned to the WebView |
| Release signing key | `android/hwfee-release.jks` + `android/keystore.properties` (**both gitignored**) |

- **Upgrade continuity**: keep both signing files safe; losing them prevents in-place APK upgrades on the phone without uninstalling and wiping app data.
- **Release certificate**: `CN=HwFee English, OU=Personal, O=HwFee, C=CN`, SHA-256 fingerprint `ab63a748ce01b01e3e20e6f4a56abf1ab1bd4944855900aa0c53d853a17eb58c`.

## Known limitations & risks

1. **Unofficial Shanbay endpoints**: upstream paths can change without notice. All calls live behind `ShanbayPlugin` / `ShanbaySseClient` / `web/read/bridge.mjs`, and manual `Cookie` / cURL paste stays available as a fallback.
2. **Guest-cookie capture trap**: Shanbay sets an `auth_token`-shaped cookie prior to credential submission. `LoginActivity` probes `/bayuser/user` and refuses to overwrite a valid session with an unauthenticated cookie.
3. **Trusted lessons only**: imported `cherina-pod` lessons share `https://localhost` origin with the shell and reader, so arbitrary untrusted HTML/JS packages would share localStorage and the native bridge.
4. **ROM background policies**: Android vendor battery savers vary; `PlaybackService` uses a foreground media service + bounded partial `WakeLock` for sleep timers, while full ExoPlayer replacement remains an intentionally unchosen path unless proved necessary.

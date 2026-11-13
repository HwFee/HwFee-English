# HwFee English

One Android app for two personal tools: cherina-pod 精听 lessons and 扇贝阅读 精读. Capacitor shell with a native plugin layer.

## Where things are

- `README.md` — project overview, repository layout, and documentation index.
- `HANDOFF.md` — current `v1.0.12` state, pending real-device verification, secrets, and known boundaries.
- `docs/DEV.md` — build, tests, emulator/CDP verification, and gotchas. Read it before changing behaviour.
- `docs/CHANGELOG.md` — consolidated version history from `v1.0.0` to `v1.0.12-v7`.
- `docs/LISTENING.md` & `listening/cherina-pod/SKILL.md` — unified 39-lesson schema, progress migration, and course production. Read both before course production.
- `docs/shanbay-api.md` — the reverse-engineered Shanbay endpoints, with the verified ones marked.

## UI work

Both tabs run on cherina-pod's own tokens (`#F5F5F7` ground, `#0071E3` accent, `#FF6B00` flame), light and dark. The 精听 tab keeps cherina-pod's generated pages untouched on disk; fixes to library/player/handout go into `LessonServer` serve-time injectors (`injectLibraryFixes`, `injectPlayerFixes`, `injectHandoutFixes`). 词间 and 设置 are ours. Fonts are bundled: Noto Sans SC for all UI (also `res/font` for native), Literata for the reader's English body, and `PasswordDots.woff2` for uniform password masking.

The bottom tab bar is native: `android/.../glass/` draws a Compose liquid-glass bar (`io.github.kyant0:backdrop`, Kyant's catalog `LiquidBottomTabs`, the same library Coolapk ships) over the WebView, driven by the `TabBar` plugin. The WebView must keep `LAYER_TYPE_HARDWARE`; without it the backdrop records a software copy that drops fixed and backdrop-filter content. The web `.tabs` island is only the fallback when `Plugins.TabBar` is missing (desktop preview). Anything that must clear the bar uses the CSS var `--island-reserve`.

Apple HIG skills are installed in `.claude/skills/` and `.agents/skills/`. Load the matching one instead of guessing at Apple conventions:

| Skill | Reach for it when |
|---|---|
| `hig-foundations` | colour, type, SF Symbols, dark mode, contrast, layout basics |
| `hig-components-layout` | tab bars, navigation, list structure |
| `hig-components-dialogs` | sheet vs popover vs alert — the translate card is an anchored popover, so this is the relevant one |
| `hig-components-controls` | buttons, toggles, fields, segmented controls |
| `hig-components-menus` | toolbars and button placement |
| `hig-components-status` | loading and progress states |
| `hig-patterns` | onboarding, settings, feedback, destructive actions |
| `hig-inputs` | gestures, long press, haptics |
| `apple-design-hig`, `apple-hig-designer` | one-file HIG references for a broad question |

## Conventions

- Imported lesson files are never rewritten: the library index and the playback shim are injected while serving.
- Secrets (Shanbay cookie, LLM key) live in the Android Keystore and never reach the WebView.
- Builds need `JAVA_HOME` pointing at JDK 21. `npm run apk` and `npm test` are the two commands. The toolchain is AGP 9.1 / Gradle 9.3 / compileSdk 37 (SDK package `platforms;android-37.0`) because backdrop 2.0.1 requires it; Capacitor 7 builds on it unchanged.
- Coolapk (`base.apk`, the glass reference) is arm64-only and crashes on the x86_64 emulator; compare against it on a real phone.

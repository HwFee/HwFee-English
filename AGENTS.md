# HwFee English

One Android app for two personal tools: cherina-pod 精听 lessons and 扇贝阅读 精读. Capacitor shell with a native plugin layer.

## Where things are

- `PLAN.md` — agreed scope and decisions.
- `HANDOFF.md` — what works, what is left, where the secrets live, decisions already settled.
- `docs/DEV.md` — build, emulator, CDP verification. Read it before changing behaviour.
- `docs/shanbay-api.md` — the reverse-engineered Shanbay endpoints, with the verified ones marked.
- `designs/hwfee-english-ui/` — the UI design board, edited through the dashboard editor.

## UI work

Both tabs run on cherina-pod's own tokens (`#F5F5F7` ground, `#0071E3` accent, `#FF6B00` flame). The 精听 tab keeps cherina-pod's generated page untouched; 词间 and 设置 are ours.

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
- Builds need `JAVA_HOME` pointing at JDK 21. `npm run apk` and `npm test` are the two commands.

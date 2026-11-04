# HwFee English — Android app plan

One app with a local course generator. `listening/cherina-pod` supplies the **Listen** tab; `扇贝阅读助手` supplies the **Read** tab. The course generator and all earlier material migrated here on 2026-11-04; see `docs/LISTENING.md`.

Start at M0 — scaffold plus one APK installed on the phone. Nothing else is real until that runs.

## Decisions

| Question | Answer |
|---|---|
| Scope | One app, two tabs. Shanbay data refreshes on the phone; lessons arrive by zip import. |
| Stack | Capacitor shell + native Kotlin plugin layer. Both web UIs survive nearly verbatim. |
| Translation and analysis | Shanbay SSE first, personal DeepSeek / OpenAI-compatible API fallback. One opt-in preparation switch warms translations and 10–120-word analyses; manual work shares their 30-day caches. |
| Build | User authorized 1.0.9 packaging (versionCode 10), including the revised unified 39-lesson ZIP, on 2026-11-04 after the UI rollback and listening fixes. No phone installation or remote push is authorized by packaging alone. |
| Playback | Background audio, lock-screen controls, sleep timer. |
| Session | In-app Shanbay login WebView, cookie captured from `CookieManager`, paste-a-cURL as fallback. |

## Architecture

```
HwFee-English/
  android/                  # Capacitor Android project (Gradle)
  web/                      # what the WebView loads, single origin
    shell/                  # tab bar, routing, settings
    listen/                 # vendored player.html + index.html + js shim
    read/                   # ported index.html / app.js / style.css
  plugins/
    shanbay/                # Kotlin: cookie-authed HTTP against apiv3
    lessons/                # Kotlin: SAF import, unzip, serve under /lessons/
    audio/                  # Kotlin: foreground service + MediaSession
    vault/                  # Kotlin: Android Keystore for cookie + LLM key
  tools/sync-web.ps1        # copies templates out of the two repos
  docs/shanbay-api.md       # the reverse-engineered endpoint map
```

**Single origin.** Everything loads from one Capacitor origin (`https://localhost`), so `localStorage` is shared across lessons and tabs. This is what makes `cherina-pod:activity` (streak) and `cherina-pod:saved` (review schedule) accumulate instead of resetting per `file://` file — a bug the current flow cannot fix.

**Vendored, not linked.** `tools/sync-web.ps1` copies `cherina-pod/scripts/templates/{player,index}.html` and `扇贝阅读助手/public/*` into `web/`. The app never builds against the other two repos at runtime; refreshing the templates is one explicit command.

## Why native networking is unavoidable

Verified against your live account: sending an explicit `Cookie: auth_token=…; csrftoken=…` header plus `Origin: https://web.shanbay.com` and `X-CSRFToken` returns **200** on `/bayuser/user` and `/wordsapp/user_material_books/current` from a plain non-browser client.

So the data layer is proven. But a WebView cannot do it: `Cookie` is a forbidden header for browser `fetch`, and these calls are cross-origin. Every Shanbay request goes through the Kotlin bridge.

## Read tab

Daily refresh on open: today's words (`today_learning_items`, paged 50 at a time) and today's article (词文串学 match, falling back to latest). Results mirror the current `data/today.json` + `data/article.json` shape, so the existing `app.js` rendering keeps working.

Three gestures, all reusing what the Zen extension already proved:

1. **Long-press a sentence → sentence tools.** Shanbay analysis/translation is primary; the personal LLM API is fallback. The anchored card renders completed, validated results with loading/error/retry feedback. Analysis returns exact-text schema 2 components. Optional article preparation runs on app open/resume, shares manual-request work and retains completed answers for 30 days. Usage-display backend is ready; the other model owns its Settings frontend. See `docs/llm-api.md` and `docs/usage-api.md`.
2. **Tap a word → popup with meaning + add to wordbook.** Meaning from the local vocab index (built from `user_vocabs` at sync). Add/remove hits `/wordscollection/words` — the same endpoint the extension calls — and the popup reflects real membership via `words_check` rather than assuming.
3. **Highlight words in the text.** Built from `user_vocabs?categories=today,wordbook,learned,unlearned`, defaulting to `today` + `wordbook`, with per-category toggles in settings. Rendered by our own DOM pass over the paragraphs, so it does not depend on the extension's marking code.

## Listen tab

The player page stays exactly as generated — same layout, same line-by-line sync, same blind listening. Changes are all around it:

- **Import** accepts both shipped shapes: folder form (`cet4/<slug>/player.html` + `audio/episode.mp4`) and single-file form (self-contained `.html` with inlined audio, up to ~10 MB each). Picker via SAF, plus a share-sheet entry point.
- **Serving** puts every lesson at `/lessons/<id>/...` so relative `audio/episode.mp4` resolves untouched.
- **Background audio** is a foreground service holding a `MediaSession`; a small injected shim reports play state and accepts play/pause/seek from the lock screen, and hosts the sleep timer.

## Security

Neither secret touches `localStorage` or the zip files.

- Shanbay cookie → Android Keystore, sealed per device. Replaces `secure-store.mjs`, whose DPAPI/pwsh path has no Android equivalent.
- LLM key + base URL + model → Keystore, configured on a settings screen.
- Both are redacted from every log line, matching the existing 不打印密钥 rule.

## Milestones

| # | Work | Estimate |
|---|---|---|
| M0 | Capacitor scaffold, Gradle build, APK installed on device | 1–2 h |
| M1 | Listen tab: import, unzip, single-origin serving, library page | 3–4 h |
| M2 | Read tab: ported UI + daily fetch through the bridge | 3–4 h |
| M3 | Three reading gestures | 4–6 h |
| M4 | Login WebView + Keystore vault + settings | 2–3 h |
| M5 | Background audio, MediaSession, sleep timer | 4–6 h |
| M6 | History browser, offline cache, icon and splash | 2–3 h |

Roughly 20–28 hours total. M1 and M2 each end with something you can look at on the phone.

## Risks

1. **Shanbay's API is unofficial** — it can change without notice. Mitigation: one HTTP module, precise error surfaces, and the paste fallback stays.
2. **WebView background audio varies by device** — some ROMs pause WebView media anyway. Mitigation: foreground service first; if your phone still pauses, fall back to driving audio with ExoPlayer behind the same UI (the rejected Q5 option).
3. **Import size** — 整库 zips run 336 MB and single files 10 MB apiece. Mitigation: streamed unzip, no full-file buffering, storage check before extracting.
4. **Sideload only** — an unofficial Shanbay client with cookie login does not belong on Play. Distribution is a signed APK you install directly.
5. **Verification gap** — an emulator cannot judge real audio focus or lock-screen behavior. Those need your actual phone over adb.

## Defaults I picked

Correct any of these and the plan changes locally:

- App name **HwFee English**, package `com.hwfee.english`.
- Word adding targets your Shanbay word *collection* (`/wordscollection/words`), the same thing the extension's heart button does — not the learning book (六级考纲词汇精简版).
- Highlight starts with `today` + `wordbook` on.
- Article history keeps a browsable local archive rather than today-only.

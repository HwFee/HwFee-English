`dist/HwFee-English-1.0.12-v5.apk` contains the reader recovery, highlight refresh and settings alignment fixes.

## Reader recovery

The real Chromium reader reproduced an interrupted native request that left a permanent loading
skeleton, and click-only outside activation that did not dismiss the card. These paths now show a
retry or dismiss normally. This does not establish the cause of every reported phone failure:
the affected phone's force-stop/re-login sequence has not been reproduced on a device.

- Outside pointer events and keyboard/accessibility clicks dismiss both kinds of card, including
  clicks in the parent shell. Releasing a long press does not dismiss its newly opened card;
  an omitted release-click expires instead of swallowing a later activation.
- A dismissal consumes that gesture even when its release lands on another word. A fresh tap can
  open the next word. Release outside the article, drag, multi-touch, nested scroll, backgrounding,
  article replacement and tab/back navigation cancel pending holds.
- Interrupted requests have a retry instead of an endless skeleton. Loading is labelled; after
  eight seconds the card explains that waiting can be cancelled. Failure includes recovery steps
  and any supplied quota reset time. Closing unsubscribes both sentence tabs; late replies and
  queued callbacks from an old card cannot close or replace a newer card.
- A sentence occupying the available viewport now suggests scrolling **or reducing the font**.
  The no-overlap placement rule remains intact; an impossible placement does not send a request.

## Highlights: checked against the installed Zen extension

Read-only source inspection found **扇贝翻译 0.17.1**, extension ID
`{09767ac2-b538-a31e-5ddd-2ad053169458}`. No browser credentials or extension storage were read.
Its background code merges headwords/variants, tracks `covered_categories` and the feed date, and
periodically synchronizes rather than trusting a long-lived table indefinitely.

The app retains its six-hour offline snapshot but revalidates on startup, reader entry and resume,
throttled to one attempt per minute. The reader has an explicit **刷新高亮** action; failed or partial
sync is visible and retryable. Missing coverage does not erase the last available category or renew
an incomplete result as a complete cache.

The already-fetched NEW/REVIEW headwords are retained in reader state and supplement the translation
feed. Provider-supplied variants inherit those daily flags; apostrophe/hyphen typography and
possessives match without guessing arbitrary inflections. Date rollover clears yesterday's daily
flags while retaining wordbook flags. Dashboard totals still use their separate official sources.
The feed remains a server-selected subset; this pass did not perform fresh account GET requests or
prove that Shanbay returns every collected word. No fabricated category membership is introduced.

## Settings alignment

Matched the preview heading line height, quota's small “剩余” label, field and disclosure spacing,
Cookie textarea, model labels/list rows, toggle copy and appearance action. Choosing a model closes
the picker; manual selection focuses the model-ID field. Long model names truncate within the row;
provider IDs remain available as tooltips.

A native password input normally uses Noto Sans SC's tiny U+2022 glyph, unlike the saved placeholder's
large U+25CF circle. `tools/generate-password-font.py` generates the 800-byte OFL-licensed
`web/fonts/PasswordDots.woff2`, mapping both characters to the same filled circle. Drafts and saved
placeholders now match, in the app and preview, without a plaintext overlay or reading a saved key.

## Verification

- `npm test`: **252 Web tests passed**; **173 native tests**, zero failures/errors and the three
  existing Windows symlink skips. `node tools/verify-saved-review.mjs` still passes, including
  3 → 2 → 1 → 0 bookmarks and an unchanged normal checkpoint.
- Chromium used the real modules with a mocked native bridge. The event-driven stress pass ran
  **250 taps and 160 tab switches**: at most one card, no orphan highlight, two shared tab requests,
  successful retry after interruption and no replacement by late answers. CDP touch input separately
  reproduced and rechecked long-press opening and interrupted-request recovery.
- Settings layout was compared at **390/326 px, light/dark, Cookie open/closed**, with the preview's
  phone border/status inset normalized to the content viewport. Checked bounds agree within 0.01 px;
  the model list's rows and explicit/system appearance states also agree. Draft lengths 1/12/128
  preserve field height and cause no document overflow. Canvas rasterization of both mask glyphs
  is identical. Screenshot capture was unavailable because the browser window was minimized;
  these are DOM/glyph measurements, not a phone screenshot claim.
- Android lint: **0 errors, 19 warnings**. Signed release build passed; all **46** source web assets
  match the APK byte-for-byte. Release certificate SHA-256 remains `ab63a748…b58c` (v1/v2 verified).
  No phone install, remote push or paid generation request was performed.

APK SHA-256: `4ce4cfbec418c3b21b3373f65eac88a5980de2c1ea0d9309824d650818155cf6`.

Install `dist/HwFee-English-1.0.12-v5.apk` over the existing release; do not uninstall or clear app data.

# Playback and appearance investigation

Based on `origin/main` at `5d5be21` (v1.0.9). The user's primary audio report is
**normal sentence-by-sentence drill playback**: almost every sentence includes
the beginning of the following sentence before pausing. This is not merely a
looping or sentence-switching complaint.

## Implemented

- Saved-card and review Play actions now return to the lesson player before
  playing. The shell resolves legacy course IDs and opens an isolated review
  document (later bookmarks may reuse that review document). The player selects by saved audio time, so split/rebuilt sentence
  numbering does not send an old bookmark to an unrelated sentence. Metadata
  restoration finishes before the explicit selection is applied.
- Successful replacement imports invalidate the matching open player. Previously
  only the library reloaded; reopening the same lesson reused its old in-memory
  sentence timestamps. This can make an imported boundary correction appear
  ineffective until that player is destroyed.
- Explicit appearance snapshots select the existing light/dark stylesheet rules
  in the shell and each same-origin frame, including newly loaded frames. The
  app no longer depends solely on a live WebView `prefers-color-scheme` update.
  Native preference persistence and system-following remain in place.
- The closed personal API row has symmetric padding and no extra bottom margin
  before the following separator.
- Native asynchronous seeks pause the old decoder before seeking. Previously
  it continued playing while boundary checks were disabled by `seeking`.
- Native snapshots retain `boundaryPosition` and `boundaryOvershootMs` separately
  from the legacy clamped UI checkpoint. Previously the reported position was
  overwritten with `rangeEnd - 10`, hiding measured overshoot.

## Audio finding that remains open

The normal drill still uses whole-file MediaPlayer playback with polling
(1–25 ms near a boundary) followed by `pause()`. It does not enforce a decoded
sample boundary. Its control timing and actual audible stopping time must not be
inferred from the clamped UI checkpoint. The seek repair above alone does **not**
establish a fix for the user's normal-drill complaint.

No affected phone or audible reproduction is available here. The user subsequently
confirmed that the corrected ZIP was imported and restarting still leaves the issue
in the second (sentence-drill) stage. Stale in-memory course data is therefore not
a sufficient explanation for this report.
The remaining investigation needs the affected course's loaded timestamps and
actual stop measurements; persistent overshoot calls for decoder-level bounded
playback, rather than arbitrary early trimming that can cut off the current word.

## Validation

Chromium at 390×844 selected `#000000` / `#F5F5F7` for explicit dark/light modes.
The API label has 15 px above and 14 px below between the separators (the 1 px
border accounts for the difference). Web regression checks cover propagation,
same-lesson saved navigation, review routing, and replacement-import invalidation.
No release APK or phone installation was performed in this pass.

Validation completed: 185 web tests in the full run, plus the newly added served-player
metadata/navigation regression, all passed. Both targeted Android suites passed
(18 tests, no failures or skips). All 43 packaged web source files match `web/`.

## Second-stage follow-up — 2026-11-05

- Reproduced a deterministic drill bug: when a progress tick arrives over 600 ms
  beyond the sentence end, generic timeline resynchronisation advances to the
  following sentence before the drill's pause branch can run. Serve-time injection
  now gives the current sentence's stop priority in stage 2 (`st.step === 1`).
  A regression test exercises the same delayed tick in all four stages.
- The drill flag now travels through the bridge and foreground service. Only that
  mode samples MediaPlayer's audio presentation timestamp, extrapolated with its
  actual clock rate, instead of relying exclusively on coarse progress positions.
  Missing, stopped, stale or invalid timestamps fall back to the existing position
  API. No arbitrary extra early-cut margin was added.
- Native regression tests model a presentation clock already beyond the sentence
  boundary while coarse progress still trails it, plus buffering/fallback cases.
  These are software regression checks, not proof of the affected phone's audible
  latency or a guarantee that every reported tail has disappeared.

Follow-up validation: all 5 listening rebuild/navigation/stage tests and all 31
targeted native tests (clock, engine, injection, service) passed, with no failures
or skips. Older-Android test timestamp construction uses reflection because its
constructor was not public there; production only reads MediaPlayer timestamps.

## Bookmark replay must preserve normal progress — 2026-11-05

The user explicitly requires bookmark replay to leave normal course progress
untouched. Bookmark playback now opens the full player with `review=1`, after
flushing the prior normal session's current position. That document does not
write course checkpoints, completion/rating state, legacy position keys, last
lesson links, activity/completion totals, or progress migrations. Bookmark editing
itself remains available.

Normal course navigation exits review and loads a fresh normal document. A
`restoreCheckpoint` preparation request pauses any reused native decoder so its
temporary review position cannot bypass metadata-time checkpoint restoration.
The library's normal Continue links are not replaced by the temporary review.

A real generated-player regression drives saved playback, pause/time/seek/rate
events, segment/stage changes and pagehide. Persisted progress keys stay exactly
unchanged; subsequent normal loading restores the old stage, sentence and 42.25 s
checkpoint. The shell test covers normal → review → normal document transitions.

Progress-isolation validation: all 188 web tests and 21 targeted native tests passed.
All 43 Android web assets match source. No APK was produced.

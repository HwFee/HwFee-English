# Dev workflow

Everything below runs from the project root unless stated.

## Prerequisites

Listening generation, the migrated source material, unified 39-lesson package and progress migration are in [LISTENING.md](LISTENING.md). Course production no longer depends on the old desktop `English-listening` directory.

- Node.js 20+ (and npm).
- Java 21. Set `JAVA_HOME` to the JDK 21 installation, or make Java 21 the `java` on
  `PATH`. Gradle uses that installation by default. For a machine-specific override, put
  `org.gradle.java.home=/path/to/jdk-21` in `~/.gradle/gradle.properties` (on Windows, use
  the JDK path with forward slashes), or pass `-Dorg.gradle.java.home=/path/to/jdk-21`.
- Android SDK platform `android-37.0` and build tools 36.0.0 or newer (AGP 9.1). Set `ANDROID_HOME`
  (or `ANDROID_SDK_ROOT`) if the SDK is not in its standard location.

The Gradle wrapper launcher selects `gradlew.bat` on Windows and `gradlew` on Linux/macOS.

## Build the APK

```sh
npm ci
# Optional: refresh vendored web assets when their source projects change (requires PowerShell).
pwsh -File tools/sync-web.ps1
npx cap sync android
npm run apk                       # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release               # -> android/app/build/outputs/apk/release/app-release.apk (local signing key required)
npm test                          # Node data-layer tests + native/Robolectric unit tests
npm run lint:android              # Android compatibility and correctness checks
```

On Windows PowerShell, the equivalent commands are:

```powershell
npm ci
pwsh -File tools\sync-web.ps1     # only when the two source repos changed
npx cap sync android
npm run apk                       # -> android\app\build\outputs\apk\debug\app-debug.apk
npm test                          # Node data-layer tests + native/Robolectric unit tests
npm run lint:android
```

`npm run apk` is about 20–80 seconds warm. Gradle options and additional tasks can be forwarded,
for example `npm run apk -- --stacktrace`.

`npm run test:web` runs just the Node tests, and `npm run test:android` runs just the native tests.
The web command uses Node's automatic discovery (`node --test`), including on Windows; avoid
shell globs that can silently select no tests on older Node versions.
The native suite uses local mock HTTP servers plus Robolectric for Android service and import
integration checks, including API 23 compatibility. Its first run downloads Android test runtimes
from Maven; no Shanbay account, LLM key, emulator, or release signing key is required. In a proxied
environment, both Gradle and its test JVM need the configured proxy and CA trust for those runtime
downloads. Keep localhost excluded from the proxy so the mock servers remain local.

Release builds enable [R8 code and resource optimization](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization).
`android/app/proguard-rules.pro` preserves the native bridge annotations, plugin methods,
picker callbacks. `res/raw/keep.xml` preserves
Cordova's generated `config.xml`, which is looked up by name at runtime. External lesson shares
accept provider-backed `content://` URIs; debug-only `Lessons.importPath` still supports local fixtures.

To test the signed, optimized APK on an emulator, set `ANDROID_SERIAL` explicitly and run:

```powershell
node tools/android-build.mjs :app:connectedReleaseAndroidTest '-PhwfeeTestBuildType=release' '-PhwfeeTestRunner=com.hwfee.english.NativeBridgeInstrumentation'
```

This platform-only runner checks all five native plugins through JavaScript before and after Activity
recreation. It needs the local signing key and never calls a paid provider. The AndroidX/JUnit
`NativeBridgeDeviceTest` additionally checks the reflected import callback and plugin release in debug.
Both the default debug variant and the AndroidX runner remain selected when the properties are omitted.

The glass bar's light/dark previews are in `android/app/src/debug/java/com/hwfee/english/glass/GlassPreviews.kt`.
Preview tooling is a debug dependency and is absent from the release APK. List previews with
`android preview list 'android?app'`; render them with `android preview render 'android?app'`.

Sentence analysis and translation use Shanbay SSE first, with a personal API as fallback. DeepSeek
is the default fallback provider. Custom Android provider base URLs must use HTTPS,
without credentials, query parameters, or fragments. Clearing the base URL/model fields restores
the defaults; updating only a key through the native API preserves the existing base URL/model.
Changing the base URL while a key exists requires re-entering the destination provider's key.
The translation tests use local HTTP fixtures and never call a paid provider.

Translation caching, daily pretranslation and the structured long-sentence backend are documented
in [llm-api.md](llm-api.md); the Settings usage backend is in [usage-api.md](usage-api.md).
The separate [DeepSeek balance query](deepseek-balance-api.md) uses the saved official provider key.
Run both web and native tests after changing that shared path. Historical release checks and
validations from `1.0.0` through `1.0.12-v7` are summarized in [CHANGELOG.md](CHANGELOG.md).

Additional local checks and font/asset tools:

- `node tools/verify-saved-review.mjs` — exercises the Java-served library fixture, bookmark review
  actions (`忘了` / `模糊` / `记住了`), and live count updates together (run after `npm test`).
- `node tools/benchmark-library.mjs` — repeats the library storage parsing micro-benchmark.
- `python tools/generate-password-font.py` — regenerates `web/fonts/PasswordDots.woff2` from the
  bundled OFL Noto Sans SC source; the runtime input remains native and never receives a saved key.
- `python tools/generate-tab-font.py` — subsets `android/app/src/main/res/font/noto_sans_sc_tabs.ttf`
  if native tab labels in `GlassTabBar.kt` change.

`SentenceClipDeviceTest` uses a synthetic AAC asset with two consecutive tones. Set `ANDROID_SERIAL`
to the intended emulator, then run:

```sh
node tools/android-build.mjs :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.hwfee.english.SentenceClipDeviceTest
```

Regenerate app icons and splash resources with `npm run assets:generate`, then validate the five
PNG densities and adaptive/monochrome resources with `npm run assets:check`. See
`assets/brand/README.md` for the drawing, tokens and Android resource map. Capacitor defaults are
removed by the generator; run `npx cap sync android` after changing the web favicon.

WebView debugging follows the Android build flag: debug APKs expose CDP; signed release APKs do
not. Private data, the login WebView cookie jar, and the vault are excluded from Android backup
and device transfer. Disconnecting Shanbay clears both the vault entry and the WebView cookies.
Only import trusted cherina-pod lessons: their JavaScript shares the app origin and native bridge.

## Emulator

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd hwfee -no-window -no-audio -no-boot-anim `
  -gpu swiftshader_indirect -no-snapshot -accel on     # long-running, start it in the background
```

On Linux/macOS, set `ANDROID_HOME` to the SDK location and launch the emulator with
`"$ANDROID_HOME/emulator/emulator" -avd hwfee -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -accel on`.
Use `adb` from `$ANDROID_HOME/platform-tools` for the install and device commands below; the
same `npm run apk` and `npm test` commands work on all three platforms.

Boot takes about 50 seconds. Wait with `adb shell getprop sys.boot_completed` until it prints `1`.

## Install and drive the app

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install -r android\app\build\outputs\apk\debug\app-debug.apk
& $adb shell am start -n com.hwfee.english/.MainActivity

# attach a JS console to the running WebView
$appPid = ((& $adb shell pidof com.hwfee.english) | Out-String).Trim()
& $adb forward tcp:9222 "localabstract:webview_devtools_remote_$appPid"
node tools\invoke.mjs "Capacitor.Plugins.Lessons.list()"
```

Linux/macOS equivalent (with `ANDROID_HOME` set):

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.hwfee.english/.MainActivity
app_pid=$(adb shell pidof com.hwfee.english | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$app_pid"
node tools/invoke.mjs "Capacitor.Plugins.Lessons.list()"
```

`tools\invoke.mjs` evaluates any expression in the page, awaits promises, and prints the value.
That is how bridge calls, injected pages and player state get checked without UI automation.

Screenshot: `adb shell screencap -p /sdcard/s.png` then `adb pull /sdcard/s.png .tmp\shots\name.png`.

## Importing a lesson zip on the emulator

Scoped storage blocks `/sdcard/Download`, and a shell-created directory under
`/sdcard/Android/data` is not app-owned either. Push to `/sdcard/Download`, then copy into the app's
internal storage as the app user:

```powershell
$adb shell "cat /sdcard/Download/lesson.zip | run-as com.hwfee.english sh -c 'cat > /data/data/com.hwfee.english/files/lesson.zip'"
node tools\invoke.mjs "Capacitor.Plugins.Lessons.importPath({path:'/data/data/com.hwfee.english/files/lesson.zip'})"
```

`importPath` is debug-only (guarded by `ApplicationInfo.FLAG_DEBUGGABLE`) and exists purely so the
extraction pipeline can be exercised without hand-driving the system file picker. The release path
is the SAF picker behind the shell's import button.

## Things that bit once

- **JDK 21 required.** Capacitor 7 fails on JDK 17 with `无效的源发行版: 21`.
- **`BuildConfig` is off** under AGP 8 defaults; use the debug flag instead of changing build config.
- **One origin.** The app serves everything from `https://localhost`, including imported lessons, so
  `cherina-pod:activity` (streak) and `cherina-pod:saved` are shared across every lesson.
- **Audio needs byte ranges.** `LessonServer` answers `Range` requests itself; without that the
  player cannot seek, and line-by-line playback depends on seeking.
- **Native sentence stops use bounded audio.** `SentenceClip` decodes the selected range on a worker
  into a PCM WAV cache; the native decoder cannot read the next sentence from that file. Keep
  player positions in the full lesson timeline and wait for completion before applying sentence-end UI.
- **Two levels, one payload id.** cherina-pod's `cet4/` and `cet6/` folders carry the same lesson id,
  so the imported id comes from the path and the level goes into the title.
- **Symlink tests skip on Windows.** The lesson guards compare canonical paths. A Windows host can
  create the symlink yet `java.io` canonicalisation keeps reporting the link path, so
  `LessonPathTest` and `LessonRequestSupportTest` mark those cases skipped via `SymlinkSupport`.
  They run for real on Linux/macOS, which is also how Android behaves (`realpath` resolves links).
- **An iframe's plugin calls never resolve.** Both tabs are iframes; an iframe receives its own
  injected Capacitor whose calls hang forever. Route bridge calls through `window.top.Capacitor`.

# Dev workflow

Everything below runs from the project root unless stated.

## Prerequisites

- Node.js 20+ (and npm).
- Java 21. Set `JAVA_HOME` to the JDK 21 installation, or make Java 21 the `java` on
  `PATH`. Gradle uses that installation by default. For a machine-specific override, put
  `org.gradle.java.home=/path/to/jdk-21` in `~/.gradle/gradle.properties` (on Windows, use
  the JDK path with forward slashes), or pass `-Dorg.gradle.java.home=/path/to/jdk-21`.
- Android SDK platform 35 and build tools 34.0.0 (AGP's default). Set `ANDROID_HOME`
  (or `ANDROID_SDK_ROOT`) if the SDK is not in its standard location.

The Gradle wrapper launcher selects `gradlew.bat` on Windows and `gradlew` on Linux/macOS.

## Build the APK

```sh
npm ci
# Optional: refresh vendored web assets when their source projects change (requires PowerShell).
pwsh -File tools/sync-web.ps1
npx cap sync android
npm run apk                       # -> android/app/build/outputs/apk/debug/app-debug.apk
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
The native suite uses local mock HTTP servers plus Robolectric for Android service and import
integration checks, including API 23 compatibility. Its first run downloads Android test runtimes
from Maven; no Shanbay account, LLM key, emulator, or release signing key is required. In a proxied
environment, both Gradle and its test JVM need the configured proxy and CA trust for those runtime
downloads. Keep localhost excluded from the proxy so the mock servers remain local.

The default translation provider is DeepSeek. Custom Android provider base URLs must use HTTPS,
without credentials, query parameters, or fragments. Clearing the base URL/model fields restores
the defaults; updating only a key through the native API preserves the existing base URL/model.
The translation tests use local HTTP fixtures and never call a paid provider.

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

Screenshot: `adb shell screencap -p /sdcard/s.png` then `adb pull /sdcard/s.png docs\shots\name.png`.

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
- **Two levels, one payload id.** cherina-pod's `cet4/` and `cet6/` folders carry the same lesson id,
  so the imported id comes from the path and the level goes into the title.

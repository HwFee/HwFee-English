# Dev workflow

Everything below runs from the project root unless stated. Windows, PowerShell.

## Build the APK

```powershell
pwsh -File tools\sync-web.ps1     # only when the two source repos changed
npx cap sync android
npm run apk                       # -> android\app\build\outputs\apk\debug\app-debug.apk
```

`npm run apk` is about 20–80 seconds warm. Capacitor 7 compiles against **Java 21**; the JDK is
pinned in `android\gradle.properties` (`org.gradle.java.home`), so the shell environment does not
matter.

## Emulator

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd hwfee -no-window -no-audio -no-boot-anim `
  -gpu swiftshader_indirect -no-snapshot -accel on     # long-running, start it in the background
```

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

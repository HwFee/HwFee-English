# Copies the two source projects' web UI into web/, so the APK is self-contained.
# Run after either source project changes:  pwsh -File tools\sync-web.ps1
param(
  [string]$ListenRepo = 'C:\Users\HwFee\Desktop\English-listening\cherina-pod',
  [string]$ReadRepo   = 'C:\Users\HwFee\Desktop\扇贝阅读助手'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Copy-One([string]$from, [string]$to) {
  if (-not (Test-Path -LiteralPath $from)) { throw "missing source: $from" }
  $dir = Split-Path -Parent $to
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -LiteralPath $from -Destination $to -Force
  Write-Host ("  {0}  <-  {1}" -f (Resolve-Path -Relative $to), (Split-Path -Leaf $from))
}

Write-Host 'listen (cherina-pod templates)'
Copy-One "$ListenRepo\scripts\templates\player.html" "$root\web\listen\player.template.html"
Copy-One "$ListenRepo\scripts\templates\index.html"  "$root\web\listen\library.html"

Write-Host 'read (扇贝阅读助手)'
# index.html and app.js are authored in this project now (bridged transport + gestures);
# the upstream files land beside them as *.baseline for reference and diffing.
Copy-One "$ReadRepo\public\index.html"  "$root\web\read\index.baseline.html"
Copy-One "$ReadRepo\public\app.js"      "$root\web\read\app.baseline.js"
Copy-One "$ReadRepo\public\style.css"   "$root\web\read\style.css"
Copy-One "$ReadRepo\public\favicon.svg" "$root\web\read\favicon.svg"

Write-Host 'read (data layer, reused verbatim)'
Copy-One "$ReadRepo\lib.mjs"                     "$root\web\read\lib.mjs"
Copy-One "$ReadRepo\tools\article-source.mjs"    "$root\web\read\article-source.mjs"
Copy-One "$ReadRepo\tools\article-policy.mjs"    "$root\web\read\article-policy.mjs"
Copy-One "$ReadRepo\vendor\decode.mjs"           "$root\web\read\vendor\decode.mjs"

# decode.mjs imports node:buffer. Swap it for the browser shim so the same file runs in a WebView.
$target = "$root\web\read\vendor\decode.mjs"
$text = Get-Content -LiteralPath $target -Raw
$text = $text -replace "import \{ Buffer \} from 'node:buffer'", "import { Buffer } from './buffer-shim.mjs'"
Set-Content -LiteralPath $target -Value $text -NoNewline -Encoding utf8
Write-Host '  patched node:buffer -> ./buffer-shim.mjs'

Write-Host ''
Write-Host 'done. next: npm run sync'

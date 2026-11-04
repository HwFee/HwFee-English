Run `npm run assets:generate` to rebuild the icon and splash, then `npm run assets:check` to validate them.

The mark combines an open book with a three-bar sound waveform: 阅读 and 精听 in one silhouette.
`tools/generate-brand-assets.mjs` owns the 108-unit paths and generates both Android vectors and
PNG exports. No external image service or font is needed at app launch.

| Token | Light | Dark |
|---|---|---|
| Page / splash | `#F5F5F7` | `#000000` |
| Icon ground | `#F5F5F7` | `#1C1C1E` |
| Accent | `#0071E3` | `#2997FF` |
| Sound waveform | `#FF6B00` | `#FF6B00` |

These are the same values as `web/shell.css` and `web/read/style.css`. There is no text in the
launcher icon or launch splash. System masking supplies the adaptive icon shape; the foreground
fits Android's centered 66-dp safe circle. Legacy icons enlarge the same drawing to match the
adaptive icon's visible 72-dp viewport.

| Output | Format / size |
|---|---|
| `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}` and night equivalents | 48/72/96/144/192-px regular and round icons; 108/162/216/324/432-px transparent foregrounds |
| `mipmap-anydpi-v26` | Adaptive regular/round icons, density foreground + day/night background, monochrome layer |
| `mipmap-anydpi-v33` | Adaptive regular/round icons, vector foreground + monochrome layer |
| `drawable/splash_mark.xml` | 288-dp vector canvas; AndroidX supplies the pre-Android-12 splash layout |
| `values{,-night}/brand_colors.xml` | Matching launch background and icon colors |

`AppTheme.NoActionBarLaunch` uses AndroidX SplashScreen and returns to `AppTheme.NoActionBar`.
`MainActivity` installs it before creating the bridge. AndroidX and the system control the handoff;
there is no minimum wait, second splash activity or full-screen PNG stretching. The launcher background
is opaque; only foreground layers and legacy icon mask corners are transparent.

`preview.png` compares light, dark, round, monochrome and splash treatments. `icon-*.svg` and
1024-px `icon-*.png` are editable/export assets. `foreground-*.svg` retains adaptive safe padding.
The web shell and reader use the same mark as their favicon; imported lesson files are unchanged.

Design references: [HIG App icons, “Design” and “Icon shape”](../../.agents/skills/hig-foundations/references/app-icons.md)
and [HIG Dark Mode, “Icons and images”](../../.agents/skills/hig-foundations/references/dark-mode.md).
The launch handoff follows [HIG Launching, “Launch screens”](../../.agents/skills/hig-patterns/references/launching.md);
Android's system splash uses the requested brand mark.
Android controls launcher masking and splash layout: [adaptive icon dimensions](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)
and [splash dimensions](https://developer.android.com/develop/ui/views/launch/splash-screen).

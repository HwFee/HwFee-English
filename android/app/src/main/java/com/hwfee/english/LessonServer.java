package com.hwfee.english;

import android.content.Context;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Locale;

/**
 * Serves imported lessons on the app's own origin, so every lesson shares one localStorage.
 * The player seeks audio constantly for line-by-line playback, so byte ranges are honoured
 * here rather than left to a plain asset loader.
 */
public final class LessonServer {

    private LessonServer() {
    }

    public static WebResourceResponse serveLesson(LessonStore store, WebResourceRequest request) throws IOException {
        String rawPath = request.getUrl().getPath();
        if (rawPath == null || !rawPath.startsWith("/lessons/")) return notFound();
        // Uri.getPath() is already decoded. Decoding it again corrupts literal '+' and '%' names.
        String relative = rawPath.substring("/lessons/".length());

        File file = LessonRequestSupport.resolveLessonFile(store.root(), relative);
        if (file == null) return notFound();
        if (!file.isFile()) return notFound();

        String mime = mimeFor(file.getName());
        long total = file.length();
        String range = header(request.getRequestHeaders(), "Range");

        // The player page is the one file that gets help: the background-playback shim goes in on
        // the way out, so the lesson HTML on disk stays exactly as cherina-pod generated it.
        if (file.getName().equals("player.html")) {
            return servePlayerWithShim(file);
        }
        if (file.getName().equals("handout.html")) {
            return serveHandout(file);
        }

        if (range != null && range.startsWith("bytes=") && total > 0
                && !LessonRequestSupport.isMultiRange(range)) {
            long[] bounds = parseRange(range, total);
            if (bounds == null) {
                Map<String, String> headers = new LinkedHashMap<>();
                headers.put("Content-Range", "bytes */" + total);
                return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", headers,
                        new ByteArrayInputStream(new byte[0]));
            }
            long start = bounds[0];
            long end = bounds[1];
            long length = end - start + 1;
            RandomAccessFile raf = new RandomAccessFile(file, "r");
            raf.seek(start);
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(length));
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, null, 206, "Partial Content", headers,
                    new LessonRequestSupport.RangeStream(raf, length));
        }

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(total));
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, null, 200, "OK", headers, rangeStream(file));
    }

    /**
     * The library page is a build-time template: __DATA__ is replaced by the live lesson index
     * on every load, so the page's own code never has to change.
     */
    public static WebResourceResponse serveLibrary(Context context, LessonStore store) throws IOException {
        String html;
        try (InputStream in = context.getAssets().open("public/listen/library.html")) {
            html = new String(readAll(in), StandardCharsets.UTF_8);
        }
        String data = store.libraryData().toString();
        html = html.replace("__DATA__", LessonRequestSupport.escapeJsonForHtmlScript(data));

        html = injectLibraryFixes(html);

        // The vendored page tells the reader to run a Python command; here there is a button.
        if (data.contains("\"lessons\":[]")) {
            html = html.replaceAll("还没有课。运行 python3[^\"]*",
                    "还没有课。点右上角的导入按钮，选择 cherina-pod 课程 ZIP。");
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * Library fixes that must apply even when the page reloads on its own:
     * the floating tab bar's clearance and the grid-cell cover stacking.
     */
    static String injectLibraryFixes(String html) {
        html = injectSavedHooks(html);
        String fixes = "<style id=\"hwfee-library-fixes\">"
                + ".wrap{padding-bottom:calc(var(--island-reserve,92px) + env(safe-area-inset-bottom))}"
                + ".stats+.empty{margin-top:16px}"
                + ".cover>*{grid-area:1/1}"
                + ".cover:has(img),.card .cover:has(img){font-size:0!important;background:none!important}"
                + "</style>";
        int head = html.indexOf("</head>");
        html = head >= 0 ? html.substring(0, head) + fixes + html.substring(head) : html;
        String shim = "<script src=\"/listen/activity.js\"></script>"
                + "<script src=\"/listen/library-shim.js\"></script>";
        int body = html.lastIndexOf("</body>");
        return body >= 0 ? html.substring(0, body) + shim + html.substring(body) : html + shim;
    }

    /** Reconnect saved clips and refresh the original cards without replacing their UI. */
    static String injectSavedHooks(String html) {
        int data = html.indexOf("id=\"data\"");
        int end = data < 0 ? -1 : html.indexOf("</script>", data);
        if (end >= 0) {
            end += "</script>".length();
            html = html.substring(0, end) + "<script src=\"/listen/saved-state.js\"></script>"
                    + "<script src=\"/listen/saved-sentences.js\"></script>" + html.substring(end);
        }
        int play = html.indexOf("function playClip(x){");
        int render = play < 0 ? -1 : html.indexOf("\nfunction renderSaved()", play);
        if (render >= 0) html = html.substring(0, play)
                + "function playClip(x){window.__hwfeeSaved.play(x);}\n" + html.substring(render);
        String marker = "renderSaved();";
        int mount = html.indexOf(marker);
        if (mount >= 0) {
            mount += marker.length();
            String hook = "window.hwfeeSavedResolved=function(k,item){if(queue)queue.forEach(function(x){if(x.k===k)Object.assign(x,item);});};"
                    // Open review from the freshest bookmark list: the template's SAV copy is
                    // only refreshed by hwfeeRefreshSaved, so a stale copy made the entry a no-op.
                    + "window.hwfeeOpenReview=function(){SAV=readJ('cherina-pod:saved',[]);"
                    + "if(!SAV.length)return false;openReview();return $('rv').classList.contains('on');};"
                    + "window.hwfeeRefreshSaved=function(){SAV=readJ('cherina-pod:saved',[]);"
                    + "due=SAV.slice();"
                    + "if(window.hwfeeRenderSavedHeader)window.hwfeeRenderSavedHeader(SAV.length);"
                    + "else $('hSaved').textContent=L.saved+(SAV.length?' '+SAV.length:'');"
                    + "var v=document.querySelector('#stRev .v');if(v){var unit=v.querySelector('small');"
                    + "v.textContent=String(due.length);if(unit)v.appendChild(unit);}(window.renderSaved||renderSaved)();"
                    + "if($('rv').classList.contains('on')&&queue&&queue[qi]){var current=queue[qi],index=qi;"
                    + "queue=(queue||[]).filter(function(x){return SAV.some(function(y){return y.k===x.k;});});"
                    + "qi=queue.findIndex(function(x){return x.k===current.k;});"
                    + "if(qi<0){qi=Math.min(index,queue.length);showCard();}"
                    + "else if(queue.length)$('rvN').textContent=(qi+1)+' / '+queue.length;}"
                    + "window.__hwfeeSaved.paint();};window.__hwfeeSaved.mount(window.hwfeeRefreshSaved);";
            hook += "window.hwfeeCloseReview=function(){if(!$('rv').classList.contains('on'))return false;"
                    + "window.__hwfeeSaved.pause();$('rv').classList.remove('on');window.hwfeeRefreshSaved();return true;};"
                    + "document.addEventListener('keydown',function(e){if(e.key==='Escape'&&window.hwfeeCloseReview())e.preventDefault();});";
            html = html.substring(0, mount) + hook + html.substring(mount);
        }
        String reviewStyle = "<style id=\"hwfee-review-layout\">"
                + ".rv{padding-bottom:var(--island-reserve,92px)}"
                // Match the reader's leading glass back button; keep clear of the shell's import action.
                + ".rv-h{position:relative;flex-shrink:0;justify-content:center;"
                + "height:calc(64px + env(safe-area-inset-top));padding:calc(10px + env(safe-area-inset-top)) 68px 10px}"
                + ".rv-h .x{position:absolute;top:calc(10px + env(safe-area-inset-top));left:12px;"
                + "width:44px;height:44px;color:var(--ink2);background:rgba(252,252,253,.62);"
                + "border:1px solid rgba(255,255,255,.55);-webkit-backdrop-filter:blur(18px) saturate(180%);"
                + "backdrop-filter:blur(18px) saturate(180%);box-shadow:0 10px 26px rgba(29,29,31,.16),"
                + "inset 0 1px 0 rgba(255,255,255,.75);transition:transform .15s ease}"
                + ".rv-h .x:active{transform:scale(.92)}"
                + ".rv-h .x:focus-visible{outline:2px solid var(--acc);outline-offset:3px}"
                + ".rv-h .x svg{width:20px;height:20px;display:block}"
                + "@media (prefers-color-scheme:dark){.rv-h .x{background:rgba(30,30,32,.62);"
                + "border-color:rgba(255,255,255,.08);box-shadow:0 10px 26px rgba(0,0,0,.55),"
                + "inset 0 1px 0 rgba(255,255,255,.14)}}"
                + "@media (prefers-reduced-transparency:reduce){.rv-h .x{background:var(--bg);"
                + "-webkit-backdrop-filter:none;backdrop-filter:none;border-color:var(--line)}}"
                + "@media (prefers-reduced-motion:reduce){.rv-h .x{transition:none}}"
                + "@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){"
                + ".rv-h .x{background:var(--bg)}}"
                + ".rv-b{min-height:0;overflow-y:auto;justify-content:flex-start}"
                + ".rv-b>#rvP{flex-shrink:0;margin-top:auto}"
                + ".rv-b>.flip{flex-shrink:0;margin-bottom:auto}"
                + ".rv-b:has(.grade.on)>.flip{margin-bottom:0}"
                + ".rv-b>.grade.on{flex-shrink:0;margin-bottom:auto}"
                + ".rv-b>.done{margin-block:auto}</style>";
        html = html.replace("id=\"rvX\" aria-label=\"close\"",
                "id=\"rvX\" type=\"button\" aria-label=\"返回课程库\" title=\"返回课程库\"");
        // The hidden prompt is part of the template markup, so replace it once here instead
        // of rewriting it from a MutationObserver after every card render.
        html = html.replace("<div class=\"q\">· · ·</div>", "<div class=\"q\">先盲听，点一下揭开原文</div>");
        html = html.replaceAll("(<button[^>]*\\bid=\"rvX\"[^>]*>)[\\s\\S]*?(</button>)",
                "$1<svg viewBox=\"0 0 256 256\" fill=\"currentColor\" aria-hidden=\"true\">"
                + "<path d=\"M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32"
                + "l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z\"/></svg>$2");
        return html.replace("</head>", reviewStyle + "</head>")
                .replace("};playClip(x);", "};window.__hwfeeSaved.play(x,{toggle:false});")
                .replace("SAV.filter(function(x){return (x.due||0)<=Date.now();})", "SAV.slice()")
                .replace("var g=+btn.dataset.g,DAY=864e5;", "var g=+btn.dataset.g,DAY=864e5;"
                        + "window.__hwfeeSaved.pause();if(g===2){var all=readJ('cherina-pod:saved',[]);"
                        + "writeJ('cherina-pod:saved',all.filter(function(y){return y.k!==x.k;}));"
                        + "queue.splice(qi,1);showCard();window.hwfeeRefreshSaved();return;}")
                .replace("qi++;showCard();", "qi++;showCard();window.hwfeeRefreshSaved();")
                .replace("au.pause();$(\"rv\").classList.remove(\"on\");location.reload();",
                "window.hwfeeCloseReview();");
    }

    /**
     * Player fixes that must apply even to lessons imported before they existed. A lesson's
     * player.html is generated by cherina-pod and is never rewritten on disk, so the geometry
     * corrections live here: the dock clears the gesture bar and the transport stays centred
     * on narrow screens.
     */
    static String injectPlayerFixes(String html) {
        String fixes = "<style id=\"hwfee-player-fixes\">"
                // The WebView runs under the navigation bar (it is only inset below the status
                // bar), so env(safe-area-inset-bottom) is 0 here. The shell mirrors the real
                // inset in --hwfee-nav-inset; the island collapses inside a player, so this is
                // all the dock has to clear.
                + ":root{--hwfee-bottom:calc(var(--hwfee-nav-inset,0px)"
                + " + env(safe-area-inset-bottom,0px))}"
                + ".app>.dock{padding-bottom:calc(12px + var(--hwfee-bottom))}"
                // 1fr tracks are floored at min-content: the 46px speed pill used to widen its
                // track and push the play button off centre. minmax(0,1fr) keeps both sides equal.
                + ".dock .ctl{grid-template-columns:minmax(0,1fr) auto auto auto minmax(0,1fr)}"
                + ".dock .ctl>.speed{min-width:min(46px,100%)}"
                + ".dock .ctl>.loop{width:min(42px,100%)}"
                // A stage that has not been reached yet reads as unavailable.
                + ".steps button.hwfee-locked{opacity:.42}"
                + ".steps button.hwfee-locked .no{color:var(--ink3)}"
                + ".stage{min-height:0}.ln.cur{max-height:var(--hwfee-line-height,none);overflow-y:auto;overscroll-behavior:contain}"
                + ".stage.hwfee-tall{-webkit-mask-image:none;mask-image:none}"
                + ".nav{position:relative}"
                // The "not yet" note sits under the chips, where nothing else lives.
                + ".hwfee-note{position:absolute;left:0;right:0;top:100%;margin-top:8px;text-align:center;"
                + "font-size:12.5px;font-weight:600;color:var(--acc-ink);opacity:0;transform:translateY(-4px);"
                + "transition:opacity .2s var(--ease),transform .2s var(--ease);pointer-events:none}"
                + ".hwfee-note.is-on{opacity:1;transform:none}"
                // The transcript sheet and the translation sheet are bottom-anchored too.
                + ".side .side-b{padding-bottom:calc(30px + var(--hwfee-bottom))}"
                + ".sheet{padding-bottom:calc(24px + var(--hwfee-bottom))}"
                + "@media (min-width:900px){.app>.dock{padding-bottom:calc(24px + var(--hwfee-bottom))}}"
                // V3 preview geometry and typography. The generated player keeps its behavior.
                + "@font-face{font-family:'Noto Sans SC';src:url('/fonts/NotoSansSC.woff2') format('woff2');"
                + "font-weight:100 900;font-display:swap}"
                + "html,body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif}"
                + ".top{padding-top:calc(4px + env(safe-area-inset-top))}"
                + ".top .col{align-items:center;gap:10px;padding:0 14px}"
                + ".kicker{font-size:12px}.ttl{font-size:18px;line-height:1.3}"
                + ".top .round{height:36px;min-width:36px}"
                + ".top #bHome{width:44px;height:44px;color:var(--ink2);background:rgba(252,252,253,.68);"
                + "border:1px solid rgba(255,255,255,.62);-webkit-backdrop-filter:blur(18px) saturate(180%);"
                + "backdrop-filter:blur(18px) saturate(180%);box-shadow:0 10px 26px rgba(29,29,31,.14),inset 0 1px 0 rgba(255,255,255,.78)}"
                + ".top .round.sleep{width:36px;padding:0;gap:0}"
                + ".top .round.sleep.is-active{background:var(--acc-soft);color:var(--acc-ink)}"
                + ".nav{padding-top:12px}.nav .col{padding:0 18px}.row1{margin-bottom:10px}"
                + ".segchip{height:30px;padding:0 12px;font-size:13px}.steps button{height:31px;font-size:12.5px}"
                + ".ln{padding:8px 0}.ln .s{font-size:17px;line-height:1.35}"
                + ".ln.cur .s{font-size:25px;line-height:1.28;letter-spacing:-.024em}.ln.cur.m .s{font-size:23px;line-height:1.34}"
                + ".ln.cur.l .s{font-size:20px;line-height:1.42}.ln.cur.xl .s{font-size:17.5px;line-height:1.5}"
                + ".ln.cur .t{font-size:15px;line-height:1.55}.acts{gap:12px;margin-top:18px}.act{width:46px;height:46px}"
                + ".orb{width:132px;height:132px;box-shadow:0 24px 50px rgba(0,0,0,.10)}"
                + ".v3-blind-copy{font-size:13px;font-weight:500;color:var(--ink2)}"
                + ".dock>.col{padding:13px 18px 14px;border:1px solid rgba(255,255,255,.62)}"
                + ".ticks{height:12px;gap:3px}.dock .ctl{gap:16px}.skip{width:42px;height:42px}.play{width:58px;height:58px}"
                + ".loop{width:40px;height:40px}"
                + "@media (prefers-color-scheme:dark){.top #bHome{background:rgba(30,30,32,.72);border-color:rgba(255,255,255,.10);"
                + "box-shadow:0 10px 26px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.14)}"
                + ".dock>.col{border-color:rgba(255,255,255,.10)}}"
                + "@media (prefers-reduced-transparency:reduce){.top #bHome{background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;border-color:var(--line)}}"
                + "@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.top #bHome{background:var(--surface)}}"
                + ".v3-sleep-scrim{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;background:rgba(0,0,0,.32)}"
                + ".v3-sleep-scrim[hidden]{display:none}.v3-sleep-sheet{width:100%;padding:12px 20px calc(28px + var(--hwfee-bottom));"
                + "border-radius:28px 28px 0 0;background:var(--surface);animation:hwfee-v3-sheet-up .24s var(--ease)}"
                + ".v3-sheet-grab{width:36px;height:4px;margin:0 auto 14px;border-radius:2px;background:var(--line)}"
                + ".v3-sleep-sheet h3{margin:0;text-align:center;font-size:18px}.v3-sleep-sheet>p{margin:4px 0 0;text-align:center;font-size:12.5px;color:var(--ink2)}"
                + ".v3-sleep-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px}"
                + ".v3-sleep-grid button{height:44px;border-radius:14px;background:var(--track);font-size:14px;font-weight:600}"
                + ".v3-sleep-grid button.is-on{background:var(--acc);color:#fff}"
                + "@keyframes hwfee-v3-sheet-up{from{transform:translateY(100%)}to{transform:none}}"
                + "@media (prefers-reduced-motion:reduce){.v3-sleep-sheet{animation:none}}"
                + "</style>";
        int head = html.indexOf("</head>");
        html = head >= 0 ? html.substring(0, head) + fixes + html.substring(head) : html;
        if (!html.contains("if(window.__hwfeeFitLyrics)")) {
            html = html.replace("function center(){", "function center(){if(window.__hwfeeFitLyrics){window.__hwfeeFitLyrics();return;}");
        }
        // Backport corrected completion and phone layout to already imported lessons.
        return html.replace("if((st.steps[g.n]||0)<2){markStep(2);save();renderSteps();}",
                        "if(st.cur+1>=g.to&&(st.steps[g.n]||0)<2){markStep(2);save();renderSteps();}")
                .replace("var H=$(\"stage\").clientHeight,y=H*0.44-(el.offsetTop+el.offsetHeight/2);",
                        "var stage=$(\"stage\"),H=stage.clientHeight;"
                        + "stage.style.setProperty('--hwfee-line-height',Math.max(80,H-24)+'px');"
                        + "stage.classList.toggle('hwfee-tall',el.offsetHeight>H*.7);"
                        + "var y=H*.5-(el.offsetTop+el.offsetHeight/2);")
                .replace("if(st.cur+1>=g.to&&st.step===1){markStep(2);setStep(2,false);playSentence(g.from);return;}",
                        "if(st.cur+1>=g.to&&st.step===1){if((st.steps[g.n]||0)<2){playSentence(st.cur);return;}"
                        + "setStep(2,false);playSentence(g.from);return;}");
    }

    /**
     * handout.html is a print-first A4 page; on a phone it gets tighter margins, readable
     * type, a scrollable notes table, room for the glass tab bar, and a floating back button
     * — all injected on the way out so the file on disk stays untouched.
     */
    static String injectHandoutFixes(String html) {
        String fixes = "<style id=\"hwfee-handout-fixes\">"
                + "@media screen{"
                // The island collapses here like it does in a player, so the page owns both
                // ends: the back button at the top, the print controls wrapped at the bottom.
                + ".page{padding:62px 16px calc(34px + var(--hwfee-nav-inset,0px) + 190px)}"
                + ".tool{position:fixed;left:12px;right:12px;top:auto;bottom:calc(var(--hwfee-nav-inset,0px) + 10px);"
                + "z-index:39;margin:0;padding:10px 12px;display:flex;gap:8px;align-items:center;"
                + "justify-content:center;flex-wrap:wrap;white-space:nowrap;"
                + "background:rgba(252,252,253,.94);color:#1D1D1F;border-radius:22px;"
                + "border:1px solid rgba(255,255,255,.55);-webkit-backdrop-filter:blur(18px) saturate(180%);"
                + "backdrop-filter:blur(18px) saturate(180%);"
                + "box-shadow:0 10px 26px rgba(29,29,31,.16),inset 0 1px 0 rgba(255,255,255,.75)}"
                + ".tool>*{flex:none}"
                + ".tool button{background:rgba(118,118,128,.12);color:#1D1D1F;font-size:12.5px;"
                + "font-weight:600;line-height:1.2;padding:7px 12px;border-radius:999px;white-space:nowrap}"
                + ".tool button.on{background:#0071E3;color:#fff}"
                + ".tool button:active{background:rgba(118,118,128,.26)}"
                // The native selects stay hidden; the injected chip strip drives them.
                + ".tool select{display:none}"
                + ".tool .rng{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%}"
                + ".tool .rng-lv{display:flex;align-items:center;width:100%;font-size:12.5px;"
                + "font-weight:600;color:#6E6E73;white-space:nowrap}"
                + ".tool .rng-lv b{color:#1D1D1F}"
                + ".tool .rng-lv .all{margin-left:auto;background:none;color:#0066CC;padding:4px 0;"
                + "font-size:12.5px;font-weight:600}"
                + ".tool .rng-c{display:flex;gap:6px;width:100%;overflow-x:auto;"
                + "-webkit-overflow-scrolling:touch;scrollbar-width:none}"
                + ".tool .rng-c::-webkit-scrollbar{display:none}"
                + ".tool .rng-c button{flex:none;min-width:34px;height:34px;padding:0 9px;border-radius:17px;"
                + "background:rgba(118,118,128,.12);color:#1D1D1F;font-size:13px;font-weight:600;"
                + "line-height:1;white-space:nowrap}"
                + ".tool .rng-c button.sel{background:#0071E3;color:#fff}"
                + ".tool .rng-c button:active{transform:scale(.9)}"
                // Two rows inside the card: the mode pills on the first, the print range
                // and the print button on the second, split by a hairline.
                + ".tool>.sep{display:none}"
                + ".tool>.sep:first-of-type{display:block;width:100%;height:1px;"
                + "background:rgba(0,0,0,.1);margin:2px 0}"
                + ".tool>button#bc,.tool>button#bd{flex:1;min-width:0}"
                + ".tool button[onclick*='print'],.tool #hwfee-save-pdf{flex:1;background:#0071E3;color:#fff}"
                + "table.notes{display:block;overflow-x:auto;font-size:12.5px;-webkit-overflow-scrolling:touch}"
                // Same floating glass circle as the reader's back button, at the same spot.
                + ".hbf{position:fixed;top:10px;left:12px;z-index:40;width:44px;height:44px;border-radius:50%;"
                + "display:grid;place-items:center;padding:0;border:1px solid rgba(255,255,255,.55);"
                + "color:#6E6E73;background:rgba(252,252,253,.62);-webkit-backdrop-filter:blur(18px) saturate(180%);"
                + "backdrop-filter:blur(18px) saturate(180%);box-shadow:0 10px 26px rgba(29,29,31,.16),"
                + "inset 0 1px 0 rgba(255,255,255,.75);transition:transform .15s ease}"
                + ".hbf:active{transform:scale(.92)}"
                + ".hbf svg{width:20px;height:20px;display:block}"
                + "}"
                + "@media screen and (max-width:600px){"
                + "h1{font-size:19px}.meta{font-size:12.5px}.method{font-size:12.5px}"
                + ".seg h2{font-size:15px}.seg h2 span{font-size:12px}"
                + ".src{font-size:15.5px;line-height:1.55}.tgt{font-size:13.5px;line-height:1.5}"
                + ".tool{gap:6px}"
                + "}"
                + "@media print{.hbf,.tool{display:none}}"
                + "</style>"
                + "<a class=\"hbf\" href=\"/listen/library.html\" onclick=\"history.back();return false\" "
                + "aria-label=\"返回课程库\" title=\"返回课程库\"><svg viewBox=\"0 0 256 256\" "
                + "fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M165.66,202.34a8,8,0,0,1-11.32,11.32"
                + "l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z\"/></svg></a>";
        int head = html.indexOf("</head>");
        if (head >= 0) html = html.substring(0, head) + fixes + html.substring(head);

        // The range picker: the generated page only offers two native <select>s, which raise
        // the dated system spinner. They stay in the DOM (hidden) so the page's own rg() keeps
        // running; this chip strip writes the values back and fires the same change event.
        String rangeScript = "<script id=\"hwfee-handout-range\">"
                + "var tool=document.querySelector('.tool'),r0=document.getElementById('r0'),"
                + "r1=document.getElementById('r1');"
                + "if(tool&&r0&&r1){"
                + "var zh=/^zh/.test(document.documentElement.lang||'zh');"
                + "var kids=[].slice.call(tool.childNodes);"
                + "for(var i=0;i<kids.length;i++)if(kids[i].nodeType===3)kids[i].remove();"
                + "var N=r0.options.length;"
                + "var rng=document.createElement('div');rng.className='rng';"
                + "var lv=document.createElement('div');lv.className='rng-lv';"
                + "lv.appendChild(document.createTextNode(zh?'打印范围：':'Range:'));"
                + "var val=document.createElement('b');lv.appendChild(val);"
                + "var all=document.createElement('button');all.type='button';all.className='all';"
                + "all.textContent=zh?'全部':'All';"
                + "all.onclick=function(){r0.value=1;r1.value=N;apply();};"
                + "lv.appendChild(all);"
                + "var chips=document.createElement('div');chips.className='rng-c';"
                + "rng.appendChild(lv);rng.appendChild(chips);"
                + "var first=tool.querySelector('.sep');"
                + "tool.insertBefore(rng,first?first.nextSibling:null);"
                + "var btns=[];"
                + "function paint(){var a=+r0.value,b=+r1.value;"
                + "val.textContent=zh?('第 '+a+' – '+b+' 段'):(a+' – '+b);"
                + "for(var i=0;i<btns.length;i++)btns[i].classList.toggle('sel',(i+1)>=a&&(i+1)<=b);}"
                + "function apply(){r0.dispatchEvent(new Event('change'));paint();}"
                + "for(var n=1;n<=N;n++){(function(n){"
                + "var btn=document.createElement('button');btn.type='button';btn.textContent=n;"
                + "btn.onclick=function(){var a=+r0.value,c=+r1.value;"
                + "if(n<a)a=n;else if(n>c)c=n;else if(n===a)c=n;else if(n===c)a=n;"
                + "else if(n-a<=c-n)a=n;else c=n;"
                + "r0.value=a;r1.value=c;apply();};"
                + "chips.appendChild(btn);btns.push(btn);})(n);}"
                + "paint();}"
                + "</script>";
        int bodyEnd = html.lastIndexOf("</body>");
        return bodyEnd >= 0 ? html.substring(0, bodyEnd) + rangeScript + html.substring(bodyEnd) : html;
    }

    private static WebResourceResponse serveHandout(File file) throws IOException {
        String html;
        try (InputStream in = new java.io.FileInputStream(file)) {
            html = new String(readAll(in), StandardCharsets.UTF_8);
        }
        html = injectHandoutFixes(html);
        html = html.replace(">打印 / 存为 PDF</button>", ">存为 PDF</button>");
        String script = "<script src=\"/listen/handout-shim.js\"></script>";
        int body = html.lastIndexOf("</body>");
        html = body < 0 ? html + script : html.substring(0, body) + script + html.substring(body);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    /** player.html plus the background-playback shim, injected on the way out. */
    private static WebResourceResponse servePlayerWithShim(File file) throws IOException {
        String html;
        try (InputStream in = new java.io.FileInputStream(file)) {
            html = new String(readAll(in), StandardCharsets.UTF_8);
        }
        html = injectPlayerFixes(html);
        html = injectNativeAudioHooks(html);
        html = injectPlayerIdentity(html);
        html = injectActivityFixes(html);
        if (!html.contains("player-shim.js")) {
            String tag = "<script src=\"/listen/player-shim.js\"></script>"
                    + "<script src=\"/listen/player-v3.js\"></script>";
            int body = html.lastIndexOf("</body>");
            html = body >= 0
                    ? html.substring(0, body) + tag + html.substring(body)
                    : html + tag;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Type", "text/html; charset=utf-8");
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers,
                new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
    }

    public static WebResourceResponse error(String mime, String message) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, "utf-8", 500, "Internal Error", headers,
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    /** Normalize the served payload before the generated player reads its storage key. */
    static String injectPlayerIdentity(String html) {
        int data = html.indexOf("id=\"data\"");
        if (data < 0) data = html.indexOf("id='data'");
        int end = data < 0 ? -1 : html.indexOf("</script>", data);
        if (end < 0) return html;
        end += "</script>".length();
        return html.substring(0, end) + "<script src=\"/listen/progress-migration.js\"></script>"
                + "<script src=\"/listen/saved-state.js\"></script>"
                + "<script src=\"/listen/player-identity.js\"></script>"
                + "<script src=\"/listen/player-layout.js\"></script>"
                + "<script src=\"/listen/native-audio.js\"></script>"
                + "<script src=\"/listen/sleep-playback.js\"></script>"
                + "<script src=\"/listen/lesson-progress.js\"></script>"
                + html.substring(end);
    }

    static String injectNativeAudioHooks(String html) {
        String marker = "renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();";
        String hooks = "window.__hwfeeNativeTick=function(){cancelAnimationFrame(raf);var before=st.cur;tick();if(before!==st.cur)tick();};"
                + "var savedRequest=0;window.__hwfeeOpenSentence=function(item){var request=++savedRequest;"
                + "var i=window.__hwfeeSavedState?window.__hwfeeSavedState.match(item,S):-1;"
                + "if(i<0){window.__hwfeeSavedState&&window.__hwfeeSavedState.remove(item);"
                + "window.parent.hwfeeSavedUnavailable&&window.parent.hwfeeSavedUnavailable(window,item);return false;}"
                + "function open(){if(request!==savedRequest)return;au.pause();goSeg(segOf(i),i);setStep(1,false);playSentence(i);}"
                + "if(au.readyState>=1)open();else au.addEventListener('loadedmetadata',function(){queueMicrotask(open);},{once:true});};"
                + "window.__hwfeeNativeRange=function(){if(au.hwfeeSleepActive)return {start:0,end:0,loop:false,drill:false};"
                + "var s=S[st.cur],g=G[st.seg];"
                + "return {start:s.a,end:(loop||st.step===1)?s.b:S[g.to-1].b,loop:loop,drill:st.step===1};};"
                + "if(window.__hwfeeProgress){var cp=window.__hwfeeProgress.install({state:st,audio:au,"
                + "segments:G,sentences:S,save:save,goSeg:goSeg,setStep:setStep,render:function(){"
                + "renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();}});"
                + "save=cp.save;goSeg=cp.goSeg;setStep=cp.setStep;}"
                + "if(window.__hwfeeSleepPlayback){var sleepTick=window.__hwfeeSleepPlayback.install({audio:au,state:st,"
                + "indexAt:findIdx,segmentOf:segOf,render:function(){"
                + "renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();},"
                + "renderLine:function(){applyLineState();updateTicks();renderSide();},"
                + "finishTick:function(){trackTime();markWords(false);renderTime();if(!au.paused)raf=requestAnimationFrame(tick);}});"
                + "var practiceTick=tick;tick=function(){if(!sleepTick())practiceTick();};}";
        return html.replace(marker, hooks + marker)
                .replace("function save(){", "function save(){if(window.__hwfeeReviewPlayback)return;")
                .replace("var sv=JSON.parse(localStorage.getItem(KEY)||\"null\")",
                        "var sv=window.__hwfeeReviewPlayback?null:JSON.parse(localStorage.getItem(KEY)||\"null\")")
                // In drill mode, late progress must stop the current sentence before
                // the generic timeline resynchronisation can advance to another one.
                .replace("if(t<s.a-0.6||t>s.b+0.6)", "if((t<s.a-0.6||t>s.b+0.6)&&!(st.step===1&&t>=s.b-0.03))")
                // A bounded native source owns its end/loop. The page must wait for
                // completion instead of stopping from an interpolated progress time.
                .replace("else if(t>=s.b-0.03){", "else if(t>=s.b-0.03&&(!au.hwfeeBoundedPlayback||au.paused)){")
                .replace("if(t<s.a-0.05||t>=s.b-0.08)au.currentTime=s.a;",
                        "if(!au.hwfeeSleepActive&&(t<s.a-0.05||t>=s.b-0.08))au.currentTime=s.a;")
                .replace("$(\"bLoop\").classList.toggle(\"on\",loop);",
                        "$(\"bLoop\").classList.toggle(\"on\",loop&&!au.hwfeeSleepActive);$(\"bLoop\").disabled=!!au.hwfeeSleepActive;")
                .replace("else if(e.key===\"r\"||e.key===\"R\"){loop=!loop;renderCtl();}",
                        "else if(e.key===\"r\"||e.key===\"R\"){if(!au.hwfeeSleepActive){loop=!loop;renderCtl();}}")
                .replace("function next(){", "function next(){if(au.hwfeeSleepActive){if(st.cur+1<S.length)playSentence(st.cur+1);return;}")
                .replace("if(k>=0)goSeg(k);", "if(k>=0&&k!==st.seg)goSeg(k);");
    }

    /** Keep the original 2-minute/completed-part rule; replace its rAF-only stopwatch. */
    static String injectActivityFixes(String html) {
        int start = html.indexOf("var lastTick=0,pendSec=0;");
        int end = start < 0 ? -1 : html.indexOf("function streak()", start);
        if (end < 0) return html;
        html = html.substring(0, start) + "var lastTick=0,pendSec=0;\n"
                + "function trackTime(){window.__hwfeeActivity&&window.__hwfeeActivity.tick();}\n"
                + "function logSegDone(){window.__hwfeeActivity&&window.__hwfeeActivity.completeSegment(G[st.seg].n);}\n"
                + html.substring(end);
        String identity = "<script src=\"/listen/player-identity.js\"></script>";
        return html.replace(identity, identity + "<script src=\"/listen/activity.js\"></script>");
    }

    public static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new LinkedHashMap<>(),
                new ByteArrayInputStream(new byte[0]));
    }

    // ---------------------------------------------------------------- helpers

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }

    private static long[] parseRange(String range, long total) {
        return LessonRequestSupport.parseRange(range, total);
    }

    private static InputStream rangeStream(File file) throws IOException {
        return new LessonRequestSupport.RangeStream(new RandomAccessFile(file, "r"), file.length());
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        return out.toByteArray();
    }

    private static String mimeFor(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

}

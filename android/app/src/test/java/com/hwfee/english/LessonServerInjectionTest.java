package com.hwfee.english;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * The player and library pages are cherina-pod's own files and are never rewritten on disk,
 * so every correction has to survive the serve-time injection. These checks keep the rules
 * that fix the phone layout from silently disappearing.
 */
public class LessonServerInjectionTest {

    private static final String PLAYER = "<!doctype html><html><head><title>t</title></head>"
            + "<body><a id=\"bHome\" href=\"../index.html\">x</a></body></html>";

    @Test
    public void playerFixesLandInHeadAndLeaveThePageAlone() {
        String fixed = LessonServer.injectPlayerFixes(PLAYER);
        assertTrue(fixed.contains("<style id=\"hwfee-player-fixes\">"));
        assertTrue(fixed.indexOf("hwfee-player-fixes") < fixed.indexOf("</head>"));
        assertTrue(fixed.startsWith("<!doctype html>"));
        assertTrue(fixed.endsWith("</body></html>"));
        assertEquals(1, count(fixed, "</head>"));
    }

    @Test
    public void playerFixesClearTheGestureBarAndCentreTheTransport() {
        String fixed = LessonServer.injectPlayerFixes(PLAYER);
        // The island collapses inside a player, so the dock only has to clear the gesture bar.
        assertTrue(fixed.contains("var(--hwfee-nav-inset,0px)"));
        assertFalse(fixed.contains("--island-reserve"));
        assertTrue(fixed.contains("grid-template-columns:minmax(0,1fr) auto auto auto minmax(0,1fr)"));
        // The speed pill may not grow its track back past the flexible column.
        assertTrue(fixed.contains("min-width:min(46px,100%)"));
    }

    @Test
    public void playerFixesWithoutAHeadDoNotCorruptTheDocument() {
        assertEquals("<html></html>", LessonServer.injectPlayerFixes("<html></html>"));
    }

    @Test
    public void libraryFixesStillClearTheIsland() {
        String fixed = LessonServer.injectLibraryFixes("<html><head></head><body></body></html>");
        assertTrue(fixed.contains("--island-reserve,92px"));
        assertFalse(fixed.contains("hwfee-player-fixes"));
        assertTrue(fixed.indexOf("library-shim.js") < fixed.indexOf("</body>"));
    }

    @Test public void lessonIdentityRunsAfterPayloadButBeforeGeneratedPlayer() {
        String input = "<script id=\"data\" type=\"application/json\">{}</script>"
                + "<script>var D=JSON.parse(document.getElementById('data').textContent)</script>";
        String fixed = LessonServer.injectPlayerIdentity(input);
        assertTrue(fixed.indexOf("player-identity.js") > fixed.indexOf("{}</script>"));
        assertTrue(fixed.indexOf("player-identity.js") < fixed.indexOf("var D="));
        assertTrue(fixed.indexOf("player-layout.js") > fixed.indexOf("{}</script>"));
        assertTrue(fixed.indexOf("player-layout.js") < fixed.indexOf("var D="));
    }

    @Test public void backgroundStopwatchReplacesTheLegacyAnimationFrameAccumulator() {
        String input = "<script src=\"/listen/player-identity.js\"></script>"
                + "var lastTick=0,pendSec=0;function trackTime(){oldAccumulator();}"
                + "function logSegDone(){oldCounter();}function streak(){return 2;}";
        String fixed = LessonServer.injectActivityFixes(input);
        assertFalse(fixed.contains("oldAccumulator"));
        assertFalse(fixed.contains("oldCounter"));
        assertTrue(fixed.contains("/listen/activity.js"));
        assertTrue(fixed.contains("window.__hwfeeActivity.completeSegment(G[st.seg].n)"));
        assertTrue(fixed.contains("function streak(){return 2;}"));
    }

    @Test public void nativeAudioAndCheckpointsRunBeforeTheGeneratedPlayer() {
        String input = "<script id=\"data\">{}</script><script>var D={};"
                + "renderTop();renderSteps();renderStage();renderTicks();renderSide();renderCtl();renderTime();"
                + "if(k>=0)goSeg(k);</script>";
        String fixed = LessonServer.injectNativeAudioHooks(LessonServer.injectPlayerIdentity(input));
        assertTrue(fixed.indexOf("native-audio.js") < fixed.indexOf("var D="));
        assertTrue(fixed.indexOf("lesson-progress.js") < fixed.indexOf("var D="));
        assertTrue(fixed.contains("window.__hwfeeNativeRange"));
        assertTrue(fixed.contains("window.__hwfeeProgress.install"));
        assertFalse(fixed.contains("if(k>=0)goSeg(k);"));
        assertTrue(fixed.contains("if(k>=0&&k!==st.seg)goSeg(k);"));
    }

    @Test public void existingPlayersReceiveTheDrillCompletionAndScrollablePhoneFix() {
        String legacy = PLAYER.replace("</body>", "if((st.steps[g.n]||0)<2){markStep(2);save();renderSteps();}"
                + "var H=$(\"stage\").clientHeight,y=H*0.44-(el.offsetTop+el.offsetHeight/2);</body>");
        String fixed = LessonServer.injectPlayerFixes(legacy);
        assertTrue(fixed.contains("if(st.cur+1>=g.to&&(st.steps[g.n]||0)<2)"));
        assertTrue(fixed.contains("--hwfee-line-height"));
        assertTrue(fixed.contains("overflow-y:auto"));
        assertTrue(fixed.contains("var y=H*.5-"));
        assertFalse(fixed.contains("y=H*0.44"));
    }

    @Test public void oldAndRebuiltPlayersDelegateEveryCenterRequestToTheFittingHelper() {
        String legacy = PLAYER.replace("</body>", "function center(){\nvar el=1;\n}</body>");
        String fixed = LessonServer.injectPlayerFixes(legacy);
        assertTrue(fixed.contains("function center(){if(window.__hwfeeFitLyrics){window.__hwfeeFitLyrics();return;}"));
        String current = PLAYER.replace("</body>", "function center(){\nif(window.__hwfeeFitLyrics){window.__hwfeeFitLyrics();return;}\n}</body>");
        assertEquals(1, count(LessonServer.injectPlayerFixes(current), "if(window.__hwfeeFitLyrics)"));
        assertFalse(LessonServer.injectLibraryFixes(PLAYER).contains("library-overrides.css"));
    }

    @Test public void librarySavedPlaybackAndRefreshRunThroughTheOriginalCards() throws Exception {
        java.nio.file.Path template = java.nio.file.Path.of("src/main/assets/public/listen/library.html");
        String source = java.nio.file.Files.readString(template);
        String data = "{\"ui\":\"zh\",\"lessons\":[{\"id\":\"course\",\"dir\":\"/lessons/course\","
                + "\"title\":\"Course\",\"podcast\":\"Test\",\"segments\":2,\"duration\":120,\"rate\":100}]}";
        String fixed = LessonServer.injectLibraryFixes(source.replace("__DATA__", data));
        assertTrue(fixed.indexOf("saved-sentences.js") < fixed.indexOf("var D=JSON.parse"));
        assertTrue(fixed.contains("function playClip(x){window.__hwfeeSaved.play(x);}"));
        assertFalse(fixed.contains("stopAt=x.b+0.15"));
        assertTrue(fixed.contains("window.hwfeeRefreshSaved=function()"));
        assertTrue(fixed.contains("window.__hwfeeSaved.mount(window.hwfeeRefreshSaved)"));
        assertFalse(fixed.contains("location.reload()"));
        java.nio.file.Path fixture = java.nio.file.Path.of("build/reports/listening-library-fixture.html");
        java.nio.file.Files.createDirectories(fixture.getParent());
        java.nio.file.Files.writeString(fixture, fixed);
    }

    private static int count(String text, String needle) {
        int total = 0;
        for (int at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) total++;
        return total;
    }
}

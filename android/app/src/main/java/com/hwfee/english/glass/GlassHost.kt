package com.hwfee.english.glass

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.getValue
import androidx.compose.runtime.SideEffect
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Reparents the WebView into a ComposeView whose backdrop the tab bar samples. */
object GlassHost {
    @JvmStatic
    fun installGlassHost(activity: Activity, webView: WebView) {
        GlassState.hostInstalled = false
        val parent = webView.parent as? ViewGroup ?: return
        val index = parent.indexOfChild(webView)
        parent.removeView(webView)
        // Keep the WebView's drawing in a hardware RenderNode so its GPU functor
        // survives the backdrop's graphicsLayer recording (software capture drops
        // composited content — backdrop-filter, fixed elements, DOM scroll).
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        val host = ComposeView(activity)
        ViewCompat.setOnApplyWindowInsetsListener(host) { _, insets ->
            GlassState.navInsetPx.floatValue =
                insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom.toFloat()
            insets
        }
        ViewCompat.requestApplyInsets(host)
        host.setContent {
            val backdrop = rememberLayerBackdrop()
            // Both the top action and the bottom switcher read this one animation.
            val hidden = GlassState.hidden.value
            val collapse by animateFloatAsState(
                if (hidden) 1f else 0f,
                tween(260, easing = CubicBezierEasing(.22f, .8f, .24f, 1f)),
                label = "chrome",
                finishedListener = { GlassState.chromeSettled(it == 1f) })
            // A quick back can reverse the target before an animation frame starts.
            SideEffect {
                if (collapse == (if (hidden) 1f else 0f)) GlassState.chromeSettled(hidden)
            }
            Box(Modifier.fillMaxSize()) {
                AndroidView(
                    factory = { webView },
                    // Lay the WebView out below the status bar instead of relying on
                    // env(safe-area-inset-top), which collapses to 0 when the view's
                    // own insets go missing (cold launch in night mode).
                    modifier = Modifier.fillMaxSize().statusBarsPadding().layerBackdrop(backdrop)
                )
                Box(Modifier.fillMaxWidth().align(Alignment.BottomCenter)) {
                    GlassTabBar(backdrop, collapse)
                }
                Box(Modifier.fillMaxWidth().align(Alignment.TopCenter).statusBarsPadding()) {
                    GlassAction(backdrop, collapse)
                }
            }
        }
        parent.addView(host, index, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        GlassState.hostInstalled = true
    }
}

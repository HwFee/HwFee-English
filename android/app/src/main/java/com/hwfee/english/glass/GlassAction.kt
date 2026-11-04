package com.hwfee.english.glass

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy

private val importIcon = phosphor("M216,144v64H40V144H24v64a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V144ZM136,140.69V24H120V140.69L77.66,98.34,66.34,109.66,128,171.31l61.66-61.65L178.34,98.34Z")
private val refreshIcon = phosphor("M224,48v56H168V88h28.66A80,80,0,1,0,208,144h16A96,96,0,1,1,208,64.5V48Z")

/** Native actions share the tab bar's clock, including interrupted transitions. */
@Composable
fun GlassAction(backdrop: Backdrop, collapse: Float) {
    val tab = GlassState.selected.intValue
    if (tab > 1 || collapse >= 1f) return
    val refresh = tab == 1
    val busy = if (refresh) GlassState.refreshBusy.value else GlassState.importBusy.value
    val dark = isSystemInDarkTheme()
    val color = if (busy) Color(0xFF0071E3) else if (dark) Color(0xFF98989D) else Color(0xFF6E6E73)
    val rotation = if (busy && refresh) {
        val transition = rememberInfiniteTransition(label = "refresh")
        val angle by transition.animateFloat(0f, 360f,
            infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "spin")
        angle
    } else 0f
    Box(Modifier.fillMaxWidth().padding(top = 10.dp, end = 12.dp), contentAlignment = Alignment.TopEnd) {
        Box(Modifier.size(44.dp).graphicsLayer {
            translationY = -66.dp.toPx() * collapse
            alpha = 1f - collapse
        }.drawBackdrop(backdrop = backdrop, shape = { CircleShape },
            effects = { vibrancy(); blur(18.dp.toPx()); lens(12.dp.toPx(), 12.dp.toPx()) },
            onDrawSurface = { drawRect(if (dark) Color(0xFF1E1E20).copy(alpha = .62f)
                else Color(0xFFFCFCFD).copy(alpha = .62f)) })
            .clickable(enabled = !busy && !GlassState.hidden.value,
                onClickLabel = if (refresh) "刷新今天的一篇" else "导入课程") { GlassState.plugin?.onAction() },
            contentAlignment = Alignment.Center) {
            Image(if (refresh) refreshIcon else importIcon,
                contentDescription = if (refresh) "刷新今天的一篇" else "导入课程",
                modifier = Modifier.size(20.dp).graphicsLayer { rotationZ = rotation },
                colorFilter = ColorFilter.tint(color))
        }
    }
}

package com.hwfee.english.glass

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop

@Composable
private fun PreviewSurface(content: @Composable (Backdrop) -> Unit) {
    val dark = isSystemInDarkTheme()
    val backdrop = rememberLayerBackdrop()
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()
            .background(if (dark) Color.Black else Color(0xFFF5F5F7))
            .layerBackdrop(backdrop).padding(24.dp)) {
            repeat(4) {
                BasicText("HwFee English · ${it + 1}",
                    Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    style = TextStyle(color = if (dark) Color.White else Color.Black, fontSize = 18.sp))
            }
        }
        Box(Modifier.fillMaxWidth().align(Alignment.BottomCenter)) { content(backdrop) }
    }
}

@Preview(name = "Glass tabs · light", widthDp = 390, heightDp = 220)
@Preview(name = "Glass tabs · dark", widthDp = 390, heightDp = 220,
    uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
fun GlassTabBarPreview() {
    PreviewSurface { GlassTabBar(it, collapse = 0f) }
}

@Preview(name = "Liquid tabs · light", widthDp = 390, heightDp = 220)
@Preview(name = "Liquid tabs · dark", widthDp = 390, heightDp = 220,
    uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
fun LiquidBottomTabsPreview() {
    var selected by remember { mutableIntStateOf(0) }
    val ink = if (isSystemInDarkTheme()) Color.White else Color.Black
    PreviewSurface { backdrop ->
        LiquidBottomTabs({ selected }, { selected = it }, backdrop, tabsCount = 3,
            modifier = Modifier.padding(12.dp)) {
            listOf("精听", "阅读", "设置").forEachIndexed { index, label ->
                LiquidBottomTab(onClick = { selected = index }) {
                    BasicText(label, style = TextStyle(color = ink, fontSize = 14.sp))
                }
            }
        }
    }
}

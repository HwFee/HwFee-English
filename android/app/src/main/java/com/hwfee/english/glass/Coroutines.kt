// Ported from Kyant0/AndroidLiquidGlass catalog (Apache-2.0).
// Android actual of the multiplatform expect declaration.
package com.hwfee.english.glass

import androidx.compose.runtime.withFrameMillis

suspend fun awaitFrame(): Long = withFrameMillis { it }

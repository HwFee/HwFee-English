package com.hwfee.english.glass

import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hwfee.english.Appearance

/** Compose-side mirror of the tab state the shell pushes through the plugin. */
object GlassState {
    val selected = mutableIntStateOf(0)
    val hidden = mutableStateOf(false)
    @Volatile var hostInstalled = false
    val importBusy = mutableStateOf(false)
    val refreshBusy = mutableStateOf(false)
    private var settledHidden: Boolean? = false
    private val waiting = mutableListOf<PluginCall>()
    var plugin: TabBarPlugin? = null
    /** Real navigation-bar bottom inset in physical px, fed by the insets listener. */
    val navInsetPx = mutableFloatStateOf(0f)

    val tabs = arrayOf("listen", "read", "settings")

    fun onTab(index: Int) {
        if (hidden.value) return
        plugin?.onUserTab(index)
    }

    fun attach(owner: TabBarPlugin) {
        waiting.clear()
        plugin = owner
        hidden.value = false
        settledHidden = false
        selected.intValue = 0
        importBusy.value = false
        refreshBusy.value = false
    }

    fun setHidden(value: Boolean, call: PluginCall) {
        if (hidden.value != value) {
            waiting.forEach { it.resolve(JSObject().put("settled", false)) }
            waiting.clear()
            settledHidden = null
        }
        hidden.value = value
        if (settledHidden == value) call.resolve(JSObject().put("settled", true))
        else waiting.add(call)
    }

    fun chromeSettled(value: Boolean) {
        if (hidden.value != value) return
        settledHidden = value
        waiting.forEach { it.resolve(JSObject().put("settled", true)) }
        waiting.clear()
    }
}

@CapacitorPlugin(name = "TabBar")
class TabBarPlugin : Plugin() {

    override fun load() {
        activity.runOnUiThread { GlassState.attach(this) }
    }

    fun onAction() {
        if (GlassState.hidden.value) return
        val index = GlassState.selected.intValue
        if (index < 2) notifyListeners("actionPressed",
            JSObject().put("action", if (index == 0) "import" else "refresh"))
    }

    /** User tapped or dragged to a tab inside the Compose bar. */
    fun onUserTab(index: Int) {
        GlassState.selected.intValue = index
        notifyListeners("tabSelected", JSObject().put("tab", GlassState.tabs[index]))
    }

    @PluginMethod
    fun setState(call: PluginCall) {
        activity.runOnUiThread {
            val tab = call.getString("tab")
            if (tab != null) GlassState.selected.intValue = GlassState.tabs.indexOf(tab).coerceAtLeast(0)
            call.getBoolean("importBusy")?.let { GlassState.importBusy.value = it }
            call.getBoolean("refreshBusy")?.let { GlassState.refreshBusy.value = it }
            val hidden = call.getBoolean("hidden")
            if (hidden == null) call.resolve()
            else GlassState.setHidden(hidden, call)
        }
    }

    @PluginMethod
    fun getAppearance(call: PluginCall) {
        val mode = Appearance.getMode(context)
        call.resolve(JSObject().put("mode", mode).put("dark", Appearance.isDark(context, mode)))
    }

    @PluginMethod
    fun setAppearance(call: PluginCall) {
        val mode = call.getString("mode")
        if (mode == null) {
            call.reject("Missing appearance mode")
            return
        }
        activity.runOnUiThread {
            try {
                Appearance.setMode(activity, mode)
                call.resolve(JSObject().put("mode", mode).put("dark", Appearance.isDark(activity, mode)))
            } catch (error: IllegalArgumentException) {
                call.reject("Unknown appearance mode", error)
            }
        }
    }

    @PluginMethod
    fun getMetrics(call: PluginCall) {
        val density = context.resources.displayMetrics.density
        // CSS px from the viewport bottom to 8dp above the bar's top edge:
        // real nav inset (px) + 8dp bottom offset + bar 64dp + 8dp clearance.
        val navInset = if (GlassState.navInsetPx.floatValue > 0f)
            GlassState.navInsetPx.floatValue
        else context.resources.getDimensionPixelSize(
            context.resources.getIdentifier("navigation_bar_height", "dimen", "android")).toFloat()
        call.resolve(JSObject().put("available", GlassState.hostInstalled)
            .put("reserve", (navInset + (8f + 64f + 8f) * density) / density)
            // The raw gesture-bar inset in CSS px: pages that draw their own bottom bar
            // (the lesson player's dock) clear it without guessing.
            .put("navInset", navInset / density))
    }
}

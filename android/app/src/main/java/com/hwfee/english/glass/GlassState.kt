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
        finishWaiting(false)
        plugin = owner
        hidden.value = false
        settledHidden = false
        selected.intValue = 0
        importBusy.value = false
        refreshBusy.value = false
    }

    fun detach(owner: TabBarPlugin) {
        // A destroyed Activity must not detach its replacement's plugin.
        if (plugin !== owner) return
        finishWaiting(false)
        plugin = null
        hostInstalled = false
        navInsetPx.floatValue = 0f
        settledHidden = null
    }

    private fun finishWaiting(settled: Boolean) {
        val calls = waiting.toList()
        waiting.clear()
        calls.forEach { it.resolve(JSObject().put("settled", settled)) }
    }

    fun updateNavigationInset(bottom: Int) {
        val next = bottom.coerceAtLeast(0).toFloat()
        if (navInsetPx.floatValue == next) return
        navInsetPx.floatValue = next
        plugin?.onMetricsChanged()
    }

    fun setHidden(value: Boolean, call: PluginCall) {
        if (hidden.value != value) {
            finishWaiting(false)
            settledHidden = null
        }
        hidden.value = value
        if (settledHidden == value) call.resolve(JSObject().put("settled", true))
        else waiting.add(call)
    }

    fun chromeSettled(value: Boolean) {
        if (hidden.value != value) return
        settledHidden = value
        finishWaiting(true)
    }
}

@CapacitorPlugin(name = "TabBar")
class TabBarPlugin : Plugin() {
    @Volatile private var destroyed = false

    override fun load() {
        activity.runOnUiThread {
            if (!destroyed) GlassState.attach(this)
        }
    }

    override fun handleOnDestroy() {
        destroyed = true
        activity.runOnUiThread { GlassState.detach(this) }
        super.handleOnDestroy()
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
            if (destroyed || GlassState.plugin !== this) {
                call.reject("底栏已关闭")
                return@runOnUiThread
            }
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
        activity.runOnUiThread { call.resolve(metrics()) }
    }

    fun onMetricsChanged() {
        if (!destroyed && GlassState.plugin === this) notifyListeners("metricsChanged", metrics())
    }

    private fun metrics(): JSObject {
        val density = context.resources.displayMetrics.density
        // CSS px from the viewport bottom to 8dp above the bar's top edge:
        // real nav inset (px) + 8dp bottom offset + bar 64dp + 8dp clearance.
        // Zero is valid (for example in landscape). Real insets arrive through
        // GlassHost's listener and are republished whenever navigation changes.
        val navInset = GlassState.navInsetPx.floatValue
        return JSObject().put("available", GlassState.hostInstalled)
            .put("reserve", (navInset + (8f + 64f + 8f) * density) / density)
            // The raw gesture-bar inset in CSS px: pages that draw their own bottom bar
            // (the lesson player's dock) clear it without guessing.
            .put("navInset", navInset / density)
    }
}

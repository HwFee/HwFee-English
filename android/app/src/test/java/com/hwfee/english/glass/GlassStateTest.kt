package com.hwfee.english.glass

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class GlassStateTest {
    private class Call : PluginCall(null, "TabBar", "test", "setState", JSObject()) {
        var result: JSObject? = null
        override fun resolve(data: JSObject?) { result = data }
    }

    @After fun cleanup() { GlassState.plugin?.let { GlassState.detach(it) } }

    @Test fun destructionReleasesThePluginAndPendingAnimationCalls() {
        val owner = TabBarPlugin()
        GlassState.attach(owner)
        GlassState.hostInstalled = true
        val call = Call()
        GlassState.setHidden(true, call)
        assertNull(call.result)
        GlassState.detach(owner)
        assertNull(GlassState.plugin)
        assertFalse(GlassState.hostInstalled)
        assertEquals(false, call.result?.getBoolean("settled"))
    }

    @Test fun oldActivityDestructionCannotDetachItsReplacementOrResolveItsCalls() {
        val old = TabBarPlugin()
        GlassState.attach(old)
        val abandoned = Call()
        GlassState.setHidden(true, abandoned)
        val replacement = TabBarPlugin()
        GlassState.attach(replacement)
        assertEquals(false, abandoned.result?.getBoolean("settled"))
        GlassState.hostInstalled = true
        val pending = Call()
        GlassState.setHidden(true, pending)
        GlassState.detach(old)
        assertSame(replacement, GlassState.plugin)
        assertTrue(GlassState.hostInstalled)
        assertNull(pending.result)
        GlassState.chromeSettled(true)
        assertEquals(true, pending.result?.getBoolean("settled"))
    }
}

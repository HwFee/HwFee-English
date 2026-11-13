# Capacitor discovers plugin methods and picker/permission callbacks by annotation.
# Its consumer rules also keep Plugin subclasses; keep the app's bridge contract
# explicit here so release shrinking cannot rename methods called by JavaScript.
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keep @com.getcapacitor.annotation.CapacitorPlugin class com.hwfee.english.** extends com.getcapacitor.Plugin {
    public <init>();
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
}

# Android invokes these entry points from the WebView rather than from Java.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

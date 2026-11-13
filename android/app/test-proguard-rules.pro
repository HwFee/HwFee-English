# AndroidX Test's Error Prone annotations reference this compile-time JDK enum.
# It is absent on Android and is never needed by the instrumentation at runtime.
-dontwarn javax.lang.model.element.Modifier

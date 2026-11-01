package com.hwfee.english;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/** Import / list / remove lessons. Import runs off the main thread: a full library zip is 300 MB. */
@CapacitorPlugin(name = "Lessons", requestCodes = {LessonsPlugin.RC_ZIP})
public class LessonsPlugin extends Plugin {

    static final int RC_ZIP = 7801;

    @PluginMethod
    public void importZip(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/octet-stream"});
        startActivityForResult(call, intent, "zipPicked");
    }

    @ActivityCallback
    private void zipPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("已取消");
            return;
        }
        runImport(call, data.getData());
    }

    /** A zip handed over by another app (share sheet or file open). */
    @PluginMethod
    public void consumeShared(PluginCall call) {
        Uri uri = MainActivity.takePendingShare();
        if (uri == null) {
            JSObject empty = new JSObject();
            empty.put("imported", new JSArray());
            empty.put("failed", new JSArray());
            call.resolve(empty);
            return;
        }
        runImport(call, uri);
    }

    /**
     * Debug builds only: import a zip from a path instead of through the system picker, so the
     * extraction pipeline can be exercised from a test harness.
     */
    @PluginMethod
    public void importPath(PluginCall call) {
        boolean debuggable = (getContext().getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debuggable) {
            call.reject("仅调试版可用");
            return;
        }
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少 path");
            return;
        }
        runImport(call, Uri.fromFile(new File(path)));
    }

    private void runImport(PluginCall call, Uri uri) {
        getBridge().execute(() -> {
            try {
                LessonStore.Report report = LessonStore.get(getContext()).importZip(uri, getContext());
                JSArray imported = new JSArray();
                for (String id : report.imported) imported.put(id);
                JSArray failed = new JSArray();
                for (String reason : report.failed) failed.put(reason);
                JSObject out = new JSObject();
                out.put("imported", imported);
                out.put("failed", failed);
                call.resolve(out);
            } catch (Exception error) {
                call.reject("导入失败：" + error.getMessage());
            }
        });
    }

    /** Library payload as JSON text, which keeps the web side free of bridge-shaped objects. */
    @PluginMethod
    public void list(PluginCall call) {
        JSObject out = new JSObject();
        out.put("data", LessonStore.get(getContext()).libraryData().toString());
        call.resolve(out);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        boolean ok = LessonStore.get(getContext()).remove(id);
        JSObject out = new JSObject();
        out.put("removed", ok);
        call.resolve(out);
    }
}

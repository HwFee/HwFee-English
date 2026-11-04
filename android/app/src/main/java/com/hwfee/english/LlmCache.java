package com.hwfee.english;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Successful LLM answers, private to the app and expired 30 days after creation. */
final class LlmCache extends SQLiteOpenHelper {
    static final long RETENTION_MS = 30L * 24 * 60 * 60 * 1000;
    private long lastPrune;

    LlmCache(Context context) {
        super(context.getApplicationContext(), "llm-cache.db", null, 2);
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE answers (id TEXT PRIMARY KEY, value TEXT NOT NULL, created INTEGER NOT NULL)");
        db.execSQL("CREATE INDEX answers_created ON answers(created)");
        createUsage(db);
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) createUsage(db);
    }

    private void createUsage(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS usage_daily (day TEXT NOT NULL, provider TEXT NOT NULL, scope TEXT NOT NULL, "
                + "model TEXT NOT NULL, task TEXT NOT NULL, metrics TEXT NOT NULL, PRIMARY KEY(day,provider,scope,model,task))");
        db.execSQL("CREATE TABLE IF NOT EXISTS usage_meta (id TEXT PRIMARY KEY, value INTEGER NOT NULL)");
        db.execSQL("INSERT OR IGNORE INTO usage_meta(id,value) VALUES('trackingSince',?)", new Object[]{System.currentTimeMillis()});
    }

    String get(String id, long now) {
        prune(now);
        try (Cursor cursor = getReadableDatabase().query("answers", new String[]{"value"},
                "id = ? AND created >= ? AND created <= ?",
                new String[]{id, Long.toString(now - RETENTION_MS), Long.toString(now)}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    void put(String id, String value, long now) {
        prune(now);
        ContentValues row = new ContentValues();
        row.put("id", id);
        row.put("value", value);
        row.put("created", now);
        getWritableDatabase().insertWithOnConflict("answers", null, row, SQLiteDatabase.CONFLICT_REPLACE);
    }

    long expiresAt(String id) {
        try (Cursor cursor = getReadableDatabase().query("answers", new String[]{"created"},
                "id = ?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getLong(0) + RETENTION_MS : 0;
        }
    }

    synchronized void prune(long now) {
        if (lastPrune != 0 && now >= lastPrune && now - lastPrune < 60 * 60 * 1000) return;
        getWritableDatabase().delete("answers", "created < ? OR created > ?",
                new String[]{Long.toString(now - RETENTION_MS), Long.toString(now)});
        lastPrune = now;
    }
}

package com.sherrbyte.g1

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Tells the owner when a newer G1 is out and opens the download link in the browser.
 * The app never downloads or installs APKs itself: Play Protect treats apps that do as harmful.
 * Builds share one signing key, so the new APK installs over the old one with no uninstall.
 */
object Updater {
    private const val TAG = "G1Update"
    private const val VERSION = "https://github.com/jashwanthchowhan0009-source/G1/releases/download/apk-latest/version.json"
    private const val DOWNLOAD = "https://g-one-two.vercel.app/download"
    private const val EVERY_MS = 6 * 60 * 60 * 1000L
    @Volatile private var busy = false

    fun check(act: Activity, force: Boolean = false) {
        val prefs = act.getSharedPreferences("g1", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (busy || (!force && now - prefs.getLong("updateChecked", 0) < EVERY_MS)) return
        busy = true
        prefs.edit().putLong("updateChecked", now).apply()
        thread(name = "g1-update") {
            try {
                val c = URL(VERSION).openConnection() as HttpURLConnection
                c.instanceFollowRedirects = true
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                val v = JSONObject(c.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8))
                val newer = v.optInt("versionCode") > BuildConfig.VERSION_CODE && v.optBoolean("signed")
                act.runOnUiThread {
                    if (newer && !act.isFinishing) {
                        AlertDialog.Builder(act)
                            .setTitle("New G1: ${v.optString("versionName")}")
                            .setMessage("Download it and tap Install. It updates over this one; your settings and memory stay.")
                            .setPositiveButton("Download") { _, _ -> act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(DOWNLOAD))) }
                            .setNegativeButton("Later", null)
                            .show()
                    } else if (force) {
                        Toast.makeText(act, "G1 is up to date (${BuildConfig.VERSION_NAME})", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "update check failed", e)
            } finally {
                busy = false
            }
        }
    }
}

package com.sherrbyte.g1

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * G1 updates itself from the GitHub release: it reads version.json, downloads the new G1.apk and hands it
 * to Android's installer. The first update asks for one tap; after that Android 12+ lets G1 update quietly.
 * Only APKs signed with the same key as the installed G1 are accepted by Android, so nobody else can push one.
 */
object Updater {
    private const val TAG = "G1Update"
    private const val BASE = "https://github.com/jashwanthchowhan0009-source/G1/releases/download/apk-latest/"
    private const val PREFS = "g1"
    private const val EVERY_MS = 60 * 60 * 1000L
    @Volatile private var busy = false
    private var waitingForPermission: File? = null

    /** On every open, at most once an hour (or now, when asked). */
    fun check(act: Activity, force: Boolean = false) {
        val prefs = act.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (busy || (!force && now - prefs.getLong("updateChecked", 0) < EVERY_MS)) return
        busy = true
        prefs.edit().putLong("updateChecked", now).apply()
        thread(name = "g1-update") {
            try {
                val v = JSONObject(get(BASE + "version.json").use { it.readBytes() }.toString(Charsets.UTF_8))
                val code = v.optInt("versionCode")
                val name = v.optString("versionName")
                val skip = prefs.getInt("updateFailed", 0)
                if (code <= BuildConfig.VERSION_CODE || code == skip || !v.optBoolean("signed")) {
                    if (force) act.runOnUiThread { toast(act, "G1 is up to date (${BuildConfig.VERSION_NAME})") }
                    busy = false
                    return@thread
                }
                act.runOnUiThread { offer(act, code, name, v.optLong("bytes")) }
            } catch (e: Exception) {
                Log.w(TAG, "update check failed", e)
                busy = false
            }
        }
    }

    private fun offer(act: Activity, code: Int, name: String, bytes: Long) {
        if (act.isFinishing) { busy = false; return }
        val mb = if (bytes > 0) " (${bytes / 1_000_000} MB)" else ""
        AlertDialog.Builder(act)
            .setTitle("New G1: $name")
            .setMessage("Update now$mb? Your settings and memory stay.")
            .setPositiveButton("Update") { _, _ -> download(act, code) }
            .setNegativeButton("Later") { _, _ -> busy = false }
            .setOnCancelListener { busy = false }
            .show()
    }

    private fun download(act: Activity, code: Int) {
        toast(act, "Downloading G1 update…")
        thread(name = "g1-download") {
            try {
                val file = File(act.cacheDir, "update.apk")
                get(BASE + "G1.apk").use { input -> file.outputStream().use { input.copyTo(it) } }
                act.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("updatePending", code).apply()
                act.runOnUiThread { install(act, file) }
            } catch (e: Exception) {
                Log.w(TAG, "download failed", e)
                act.runOnUiThread { toast(act, "Update download failed. G1 will try again later.") }
                busy = false
            }
        }
    }

    private fun install(act: Activity, file: File) {
        if (!act.packageManager.canRequestPackageInstalls()) {
            // one-time: Android asks the owner to let G1 install its own updates
            waitingForPermission = file
            busy = false
            toast(act, "Allow G1 to install its updates, then come back")
            act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.packageName)))
            return
        }
        try {
            val installer = act.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(act.packageName)
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("G1.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val done = PendingIntent.getBroadcast(
                    act, id, Intent(act, UpdateReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0),
                )
                session.commit(done.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "install failed", e)
            toast(act, "Update could not be installed")
        } finally {
            busy = false
        }
    }

    /** MainActivity.onResume: the owner may have just allowed installs. */
    fun resume(act: Activity) {
        val f = waitingForPermission ?: return
        if (!act.packageManager.canRequestPackageInstalls()) return
        waitingForPermission = null
        install(act, f)
    }

    private fun get(url: String) = (URL(url).openConnection() as HttpURLConnection).run {
        instanceFollowRedirects = true
        connectTimeout = 10_000
        readTimeout = 30_000
        setRequestProperty("User-Agent", "G1-Android")
        if (responseCode !in 200..299) throw IllegalStateException("HTTP $responseCode for $url")
        inputStream
    }

    private fun toast(c: Context, s: String) = Toast.makeText(c, s, Toast.LENGTH_LONG).show()
}

/** Android reports how the update install went. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val prefs = context.getSharedPreferences("g1", Context.MODE_PRIVATE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> prefs.edit().remove("updatePending").apply()
            PackageInstaller.STATUS_FAILURE_ABORTED -> {} // "Later" in Android's dialog: ask again next time
            else -> {
                // e.g. signed with a different key: stop offering this build, show the one-time fix
                prefs.edit().putInt("updateFailed", prefs.getInt("updatePending", 0)).apply()
                Toast.makeText(
                    context,
                    "Update blocked by Android. Uninstall G1 once and install from g-one-two.vercel.app/download",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }
}

package com.sherrbyte.g1

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

/**
 * "Hey G1" while G1 is closed or the screen is off.
 *
 * Listens with Vosk, an offline recogniser that runs entirely on the phone: no audio ever leaves it,
 * and it only knows the handful of wake phrases below. When it hears one it turns the screen on and
 * opens G1 listening. While G1 is on screen this service pauses so the app has the microphone.
 */
class WakeService : Service(), RecognitionListener {
    private var model: Model? = null
    private var speech: SpeechService? = null
    private var paused = false
    private var lastWake = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val retry = Runnable { listen() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        try {
            goForeground()
        } catch (e: Exception) {
            // Android only lets the microphone start while G1 is on screen; it starts again next time G1 opens
            Log.w(TAG, "cannot listen from the background", e)
            stopSelf()
            return
        }
        StorageService.unpack(this, "model", "model",
            { m -> model = m; listen() },
            { e -> Log.e(TAG, "wake model failed", e); stopSelf() })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> { paused = true; release() }
            ACTION_RESUME -> { paused = false; listen() }
            ACTION_STOP -> { setEnabled(this, false); stopSelf() }
        }
        return START_STICKY
    }

    private fun goForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CH_LISTEN, "Hey G1", NotificationManager.IMPORTANCE_MIN))
            nm.createNotificationChannel(NotificationChannel(CH_WAKE, "G1 opens", NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, WakeService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CH_LISTEN)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Say \"Hey G1\"")
            .setContentText("Listening on this phone only. Nothing is recorded.")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Turn off", stop).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 30) startForeground(ID_LISTEN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(ID_LISTEN, n)
    }

    private fun listen() {
        val m = model ?: return
        if (paused || speech != null) return
        try {
            speech = SpeechService(Recognizer(m, 16000f, GRAMMAR), 16000f).also { it.startListening(this) }
        } catch (e: Exception) {
            Log.w(TAG, "microphone busy, trying again soon", e) // a call or another app has it
            speech = null
            handler.postDelayed(retry, 5000)
        }
    }

    private fun release() {
        handler.removeCallbacks(retry)
        speech?.let { it.stop(); it.shutdown() }
        speech = null
    }

    private fun heard(json: String?, partial: Boolean = false) {
        val text = try { JSONObject(json ?: return).optString(if (partial) "partial" else "text") } catch (e: Exception) { return }
        // "Hey G1" fires the moment it is heard; a bare "G1" or "Jeevan" waits for the pause, to avoid false wakes
        if (!(if (partial) WAKE_FAST else WAKE).containsMatchIn(text)) return
        val now = System.currentTimeMillis()
        if (now - lastWake < 4000) return
        lastWake = now
        Log.i(TAG, "wake: $text")
        paused = true
        release() // hand the microphone to G1
        cue()
        wake()
    }

    /** A short tone and buzz the moment "Hey G1" is heard, so the owner knows to speak. */
    private fun cue() {
        try {
            ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).also {
                it.startTone(ToneGenerator.TONE_PROP_ACK, 150)
                handler.postDelayed({ it.release() }, 400)
            }
        } catch (e: Exception) {}
        try {
            getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (e: Exception) {}
    }

    /** Screen on, G1 open and listening. */
    @Suppress("DEPRECATION")
    private fun wake() {
        val pm = getSystemService(PowerManager::class.java)
        pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "g1:wake")
            .acquire(5000)
        val open = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_WAKE, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try { startActivity(open) } catch (e: Exception) { Log.w(TAG, "direct open blocked", e) }
        // Android may block opening from the background without "Display over other apps".
        // This alert opens G1 full screen (or as a heads-up the owner taps) in that case.
        val pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, CH_WAKE)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("G1")
            .setContentText("Haan, bolo — tap if G1 didn't open")
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .setCategory(Notification.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(15000)
            .build()
        getSystemService(NotificationManager::class.java).notify(ID_WAKE, n)
    }

    override fun onPartialResult(hypothesis: String?) = heard(hypothesis, partial = true)
    override fun onResult(hypothesis: String?) = heard(hypothesis)
    override fun onFinalResult(hypothesis: String?) = heard(hypothesis)
    override fun onError(exception: Exception?) { Log.e(TAG, "wake error", exception); release(); if (!paused) handler.postDelayed(retry, 3000) }
    override fun onTimeout() { release(); if (!paused) listen() }

    override fun onDestroy() {
        release()
        model?.close()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "G1Wake"
        const val ACTION_PAUSE = "g1.wake.PAUSE"
        const val ACTION_RESUME = "g1.wake.RESUME"
        const val ACTION_STOP = "g1.wake.STOP"
        private const val CH_LISTEN = "g1-listen"
        private const val CH_WAKE = "g1-wake"
        private const val ID_LISTEN = 7
        const val ID_WAKE = 8
        private const val PREFS = "g1"

        // Only these phrases can be recognised; everything else comes out as [unk].
        private const val GRAMMAR = "[\"hey g one\", \"hi g one\", \"ok g one\", \"g one\", \"hey jeevan\", \"jeevan\", \"hey gee one\", \"[unk]\"]"
        private val WAKE = Regex("\\b(g one|gee one|jeevan)\\b")
        private val WAKE_FAST = Regex("\\b(hey|hi|ok) (g one|gee one|jeevan)\\b")

        fun isEnabled(c: Context) = c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("wake", false)
        fun setEnabled(c: Context, on: Boolean) = c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("wake", on).apply()

        /** Starts or nudges the service. Must first be called while G1 is on screen (Android's microphone rule). */
        fun send(c: Context, action: String? = null) {
            try {
                val i = Intent(c, WakeService::class.java).setAction(action)
                if (action == null) c.startForegroundService(i) else c.startService(i)
            } catch (e: Exception) {
                Log.w(TAG, "wake service not started", e)
            }
        }
    }
}

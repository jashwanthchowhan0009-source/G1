package com.sherrbyte.g1

import android.app.SearchManager
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.provider.MediaStore
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.Settings
import android.provider.ContactsContract
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.telephony.SmsManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder
import java.util.Locale
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.SecretKey
import javax.crypto.KeyGenerator
import javax.crypto.Cipher
import java.security.KeyStore
import android.util.Base64
import android.security.keystore.KeyProperties
import android.security.keystore.KeyGenParameterSpec

/**
 * window.G1Native inside the G1 web app. Every method is called by G1's own code only
 * (see MainActivity for why no other page can reach it).
 *
 * The web app asks the owner before anything is sent or paid; this class just carries it out.
 */
class G1Bridge(private val act: Activity, private val web: WebView) {
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    private val names: Map<String, Array<String>> = mapOf(
        "microphone" to arrayOf(Manifest.permission.RECORD_AUDIO),
        "contacts" to arrayOf(Manifest.permission.READ_CONTACTS),
        "calls" to arrayOf(Manifest.permission.CALL_PHONE),
        "camera" to arrayOf(Manifest.permission.CAMERA),
        "location" to arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
        "notifications" to (if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray<String>()),
    )

    @Volatile private var wakePending = false
    private var wantWake = false // the owner asked for "Hey G1" and Android is asking for the mic

    private fun has(permission: String) = act.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun ui(block: () -> Unit) = act.runOnUiThread { block() }

    private fun emit(type: String, data: JSONObject = JSONObject()) {
        data.put("type", type)
        ui { web.evaluateJavascript("window.dispatchEvent(new CustomEvent('g1native',{detail:$data}))", null) }
    }

    private fun start(intent: Intent): Boolean = try {
        act.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: Exception) {
        false
    }

    // ------------------------------------------------------------------ permissions

    /** {"microphone":true,"contacts":false,...} */
    @JavascriptInterface
    fun permissions(): String {
        val out = JSONObject()
        for ((name, perms) in names) out.put(name, perms.isEmpty() || perms.any { has(it) })
        out.put("wake", WakeService.isEnabled(act) && has(Manifest.permission.RECORD_AUDIO))
        out.put("popup", Settings.canDrawOverlays(act))
        out.put("update", false) // a button: "Check now"
        out.put("home", isHome())
        return out.toString()
    }

    /** Shows Android's own permission question for one connection. */
    @JavascriptInterface
    fun request(name: String) {
        if (name == "wake") return ui { turnOnWake() }
        if (name == "update") return ui { Updater.check(act, force = true) }
        if (name == "home") {
            if (!start(Intent(Settings.ACTION_HOME_SETTINGS))) start(Intent(Settings.ACTION_SETTINGS))
            return
        }
        if (name == "popup") {
            start(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + act.packageName)))
            return
        }
        val perms = names[name] ?: return
        if (perms.isEmpty()) return permissionsChanged()
        ui { act.requestPermissions(perms, MainActivity.REQ_BRIDGE) }
    }

    /** "Hey G1" even when G1 is closed: needs the microphone, and a notification while it listens. */
    private fun turnOnWake() {
        val missing = listOf(Manifest.permission.RECORD_AUDIO).plus(if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList())
            .filter { !has(it) }
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            wantWake = true
            act.requestPermissions(missing.toTypedArray(), MainActivity.REQ_BRIDGE)
            return
        }
        if (missing.isNotEmpty()) act.requestPermissions(missing.toTypedArray(), MainActivity.REQ_BRIDGE)
        WakeService.setEnabled(act, true)
        WakeService.send(act)
        WakeService.send(act, WakeService.ACTION_PAUSE) // G1 is on screen right now
        permissionsChanged()
    }

    /** MainActivity: G1 was opened by "Hey G1". The web app picks this up with takeWake(). */
    fun wake() {
        wakePending = true
        emit("wake")
    }

    @JavascriptInterface
    fun takeWake(): Boolean {
        val w = wakePending
        wakePending = false
        return w
    }

    fun permissionsChanged() {
        if (wantWake && has(Manifest.permission.RECORD_AUDIO)) {
            wantWake = false
            WakeService.setEnabled(act, true)
            WakeService.send(act)
            WakeService.send(act, WakeService.ACTION_PAUSE)
        }
        emit("permissions", JSONObject().put("state", JSONObject(permissions())))
    }

    // ------------------------------------------------------------------ doing things

    /**
     * Opens or carries out a link. Returns "placed" when it was done with no further tap
     * (a call, an SMS), "opened" when another app took over, "blocked" when nothing could.
     */
    @JavascriptInterface
    fun open(url: String): String {
        val uri = Uri.parse(url)
        return when (uri.scheme?.lowercase()) {
            "tel" -> {
                if (has(Manifest.permission.CALL_PHONE) && start(Intent(Intent.ACTION_CALL, uri))) "placed"
                else if (start(Intent(Intent.ACTION_DIAL, uri))) "opened" else "blocked"
            }
            "sms", "smsto" -> {
                val number = uri.schemeSpecificPart.substringBefore('?')
                val body = Regex("[?&]body=([^&]*)").find(url)?.groupValues?.get(1)?.let { URLDecoder.decode(it, "UTF-8") } ?: ""
                if (has(Manifest.permission.SEND_SMS) && number.isNotBlank() && body.isNotBlank() && sendSms(number, body)) "placed"
                else if (start(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).putExtra("sms_body", body))) "opened" else "blocked"
            }
            "https", "http" -> if (openOutside(url)) "opened" else "blocked"
            else -> if (start(Intent(Intent.ACTION_VIEW, uri))) "opened" else "blocked" // upi:, mailto:, geo:
        }
    }

    private fun sendSms(number: String, body: String): Boolean = try {
        @Suppress("DEPRECATION")
        val sms = if (Build.VERSION.SDK_INT >= 31) act.getSystemService(SmsManager::class.java) else SmsManager.getDefault()
        sms.sendMultipartTextMessage(number, null, sms.divideMessage(body), null, null)
        true
    } catch (e: Exception) {
        false
    }

    /** Web links leave G1. WhatsApp links go straight to WhatsApp when it is installed. */
    fun openOutside(url: String): Boolean {
        val uri = Uri.parse(url)
        if (uri.host == "wa.me" || uri.host == "api.whatsapp.com") {
            for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                if (start(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg))) return true
            }
        }
        return start(Intent(Intent.ACTION_VIEW, uri))
    }

    /** Android's share sheet, or one named app: "instagram", "facebook", "whatsapp". */
    @JavascriptInterface
    fun share(text: String, app: String): String {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        val pkg = mapOf("instagram" to "com.instagram.android", "facebook" to "com.facebook.katana", "whatsapp" to "com.whatsapp")[app.lowercase()]
        if (pkg != null && start(Intent(send).setPackage(pkg))) return "opened"
        return if (start(Intent.createChooser(send, "Share with"))) "opened" else "blocked"
    }

    // ------------------------------------------------------------------ the vault
    // Everything the app saves is encrypted with an AES key that lives in the phone's hardware keystore.
    // The key never leaves it: not to the web page, not to G1's servers, not into backups.

    private val vaultKey: SecretKey by lazy {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(VAULT, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(VAULT, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    @JavascriptInterface
    fun seal(plain: String): String? = try {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, vaultKey)
        Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    } catch (e: Exception) {
        null // the store then saves it unsealed rather than losing it
    }

    @JavascriptInterface
    fun unseal(sealed: String): String? = try {
        val all = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, vaultKey, GCMParameterSpec(128, all, 0, 12))
        String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }

    // ------------------------------------------------------------------ G1 as the home screen

    /** Every app the owner can open: [{"name":"YouTube","id":"com.google.android.youtube"}], A to Z. */
    @JavascriptInterface
    fun apps(): String {
        val pm = act.packageManager
        val out = JSONArray()
        try {
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
                .filter { it.second != act.packageName }
                .distinctBy { it.second }
                .sortedBy { it.first.lowercase() }
                .forEach { out.put(JSONObject().put("name", it.first).put("id", it.second)) }
        } catch (e: Exception) {
            // no list is better than a crash
        }
        return out.toString()
    }

    @JavascriptInterface
    fun openApp(id: String): Boolean = act.packageManager.getLaunchIntentForPackage(id)?.let { start(it) } ?: false

    /**
     * Plays or finds something in a media app. Music apps (Spotify, YouTube Music, JioSaavn) start playing
     * straight from the search; YouTube opens its results. Returns "playing", "searched", "opened" or "missing".
     */
    @JavascriptInterface
    fun play(query: String, app: String): String {
        val pkg = MEDIA[app.lowercase().trim()] ?: ""
        val q = query.trim()
        val installed = pkg.isNotEmpty() && act.packageManager.getLaunchIntentForPackage(pkg) != null
        if (pkg.isNotEmpty() && !installed) return "missing"
        if (q.isEmpty()) return if (installed && openApp(pkg)) "opened" else "missing"
        if (pkg == YOUTUBE || pkg.isEmpty()) {
            if (start(Intent(Intent.ACTION_SEARCH).setPackage(YOUTUBE).putExtra("query", q))) return "searched"
            return if (start(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))))) "searched" else "missing"
        }
        val playIt = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
            .setPackage(pkg)
            .putExtra(SearchManager.QUERY, q)
            .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
        if (start(playIt)) return "playing"
        return if (openApp(pkg)) "opened" else "missing" // Netflix, Hotstar, Prime: no public search, so just open
    }

    /** Is G1 the phone's home screen? */
    @JavascriptInterface
    fun isHome(): Boolean = act.packageManager
        .resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
        ?.activityInfo?.packageName == act.packageName

    /** MainActivity: the Home button was pressed while G1 is the home screen. */
    fun home() = emit("home")

    /** [{"name":"Papa","phone":"+9198..."}] from the phone's address book, or [] without permission. */
    @JavascriptInterface
    fun contacts(): String {
        val out = JSONArray()
        if (!has(Manifest.permission.READ_CONTACTS)) return out.toString()
        val seen = HashSet<String>()
        try {
            act.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
                null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC",
            )?.use { c ->
                while (c.moveToNext() && out.length() < 3000) {
                    val name = c.getString(0) ?: continue
                    val phone = (c.getString(1) ?: continue).replace(Regex("[^\\d+]"), "")
                    if (phone.length >= 7 && seen.add("$name|${phone.takeLast(10)}")) out.put(JSONObject().put("name", name).put("phone", phone))
                }
            }
        } catch (e: Exception) {
            // an unreadable address book is the same as an empty one
        }
        return out.toString()
    }

    /** A real alarm in the phone's clock app; it rings even when G1 is closed. */
    @JavascriptInterface
    fun setAlarm(hour: Int, minute: Int, label: String): Boolean = start(
        Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label.ifBlank { "G1" })
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true),
    )

    // ------------------------------------------------------------------ ears

    @JavascriptInterface
    fun listen(lang: String) = ui {
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MainActivity.REQ_BRIDGE)
            speech("error", "mic-blocked"); speech("end"); return@ui
        }
        if (!SpeechRecognizer.isRecognitionAvailable(act)) { speech("error", "unsupported"); speech("end"); return@ui }
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(act)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            private fun first(b: Bundle?) = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
            override fun onReadyForSpeech(params: Bundle?) = speech("start")
            override fun onPartialResults(partial: Bundle?) { first(partial).takeIf { it.isNotBlank() }?.let { speech("partial", it) } }
            override fun onResults(results: Bundle?) { speech("final", first(results)); speech("end") }
            override fun onError(error: Int) {
                speech(
                    "error",
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "mic-blocked"
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> "no-network"
                        else -> "error"
                    },
                )
                speech("end")
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true),
        )
    }

    /** finish = true delivers what was heard so far; false throws it away. */
    @JavascriptInterface
    fun stopListening(finish: Boolean) = ui {
        if (finish) recognizer?.stopListening() else { recognizer?.cancel() }
    }

    private fun speech(kind: String, text: String = "") = emit("speech", JSONObject().put("kind", kind).put("text", text))

    // ------------------------------------------------------------------ voice

    @JavascriptInterface
    fun speak(text: String, lang: String, rate: Double) = ui {
        val say = {
            val engine = tts
            if (engine == null || !ttsReady) emit("tts", JSONObject().put("kind", "done"))
            else {
                val loc = Locale.forLanguageTag(lang)
                val v = voices.getOrPut(lang) { bestVoice(engine, loc) }
                if (v != null) engine.voice = v else engine.language = loc
                engine.setSpeechRate(rate.toFloat())
                engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "g1")
            }
        }
        if (tts == null) {
            tts = TextToSpeech(act) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = emit("tts", JSONObject().put("kind", "done"))
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) = emit("tts", JSONObject().put("kind", "done"))
                })
                say()
            }
        } else say()
    }

    private val voices = HashMap<String, android.speech.tts.Voice?>()

    /** The most natural installed voice for the language: right country, highest quality, Google's network voices first. */
    private fun bestVoice(engine: TextToSpeech, loc: Locale): android.speech.tts.Voice? = try {
        engine.voices
            ?.filter { it.locale.language == loc.language && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
            ?.maxByOrNull { v ->
                (if (v.locale.country == loc.country) 1000 else 0) + v.quality +
                    (if (v.isNetworkConnectionRequired) 150 else 0) - v.latency / 2
            }
    } catch (e: Exception) {
        null
    }

    @JavascriptInterface
    fun stopSpeaking() = ui { tts?.stop() }

    @JavascriptInterface
    fun info(): String = JSONObject().put("app", "android").put("version", BuildConfig.VERSION_NAME).toString()

    fun release() {
        recognizer?.destroy()
        tts?.shutdown()
    }

    companion object {
        private const val VAULT = "g1-vault"
        private const val YOUTUBE = "com.google.android.youtube"
        private val MEDIA = mapOf(
            "youtube" to YOUTUBE,
            "youtube music" to "com.google.android.apps.youtube.music",
            "spotify" to "com.spotify.music",
            "jiosaavn" to "com.jio.media.jiobeats",
            "netflix" to "com.netflix.mediaclient",
            "hotstar" to "in.startv.hotstar",
            "prime video" to "com.amazon.avod.thirdpartyclient",
        )
    }
}

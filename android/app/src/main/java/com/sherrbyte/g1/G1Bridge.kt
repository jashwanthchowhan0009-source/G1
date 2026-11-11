package com.sherrbyte.g1

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
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
        "sms" to arrayOf(Manifest.permission.SEND_SMS),
        "camera" to arrayOf(Manifest.permission.CAMERA),
        "location" to arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
        "notifications" to (if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray<String>()),
    )

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
        return out.toString()
    }

    /** Shows Android's own permission question for one connection. */
    @JavascriptInterface
    fun request(name: String) {
        val perms = names[name] ?: return
        if (perms.isEmpty()) return permissionsChanged()
        ui { act.requestPermissions(perms, MainActivity.REQ_BRIDGE) }
    }

    fun permissionsChanged() = emit("permissions", JSONObject().put("state", JSONObject(permissions())))

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
                engine.language = Locale.forLanguageTag(lang)
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

    @JavascriptInterface
    fun stopSpeaking() = ui { tts?.stop() }

    @JavascriptInterface
    fun info(): String = JSONObject().put("app", "android").put("version", BuildConfig.VERSION_NAME).toString()

    fun release() {
        recognizer?.destroy()
        tts?.shutdown()
    }
}

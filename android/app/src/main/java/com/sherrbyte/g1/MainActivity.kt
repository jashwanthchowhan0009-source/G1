package com.sherrbyte.g1

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * G1 for Android. The screen and brain are the G1 web app, loaded from BuildConfig.G1_URL.
 * This shell adds what a browser cannot give it: contacts, calls, SMS, alarms, sharing,
 * and the phone's own speech recognition and voice, through the G1Native bridge.
 *
 * Safety: the bridge only ever exists on pages from the G1 server (HTTPS). Any other link
 * opens outside the app, so no other website can reach the phone's powers.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var bridge: G1Bridge
    private val home: Uri = Uri.parse(BuildConfig.G1_URL)
    private var pendingWebPermission: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)
        bridge = G1Bridge(this, web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(true)
            userAgentString = "$userAgentString G1Android/${BuildConfig.VERSION_NAME}"
        }
        web.setBackgroundColor(0xFF0B2A6F.toInt())

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == home.host) return false // stay inside G1
                bridge.openOutside(url.toString())                                // everything else leaves the app
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // Camera and microphone for "what is this?" and photos
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.origin.host != home.host) return request.deny()
                val needed = request.resources.mapNotNull {
                    when (it) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    }
                }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
                if (needed.isEmpty()) return request.grant(request.resources)
                pendingWebPermission = request
                requestPermissions(needed.toTypedArray(), REQ_WEB)
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                val ok = Uri.parse(origin).host == home.host &&
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                if (!ok && Uri.parse(origin).host == home.host) {
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION), REQ_BRIDGE)
                }
                callback.invoke(origin, ok, false)
            }
        }

        web.addJavascriptInterface(bridge, "G1Native")
        web.loadUrl(BuildConfig.G1_URL)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_WEB) {
            val request = pendingWebPermission
            pendingWebPermission = null
            if (request != null) {
                if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) request.grant(request.resources)
                else request.deny()
            }
        }
        bridge.permissionsChanged()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() // as a home screen G1 never closes on Back
    }

    override fun onDestroy() {
        bridge.release()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val REQ_WEB = 41
        const val REQ_BRIDGE = 42
    }
}

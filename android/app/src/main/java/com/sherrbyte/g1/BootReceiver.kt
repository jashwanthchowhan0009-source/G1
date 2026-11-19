package com.sherrbyte.g1

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** "Hey G1" comes back after a restart. Android 14+ forbids starting the microphone here; there, opening G1 once does it. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (Build.VERSION.SDK_INT < 34 && WakeService.isEnabled(context)) WakeService.send(context)
    }
}

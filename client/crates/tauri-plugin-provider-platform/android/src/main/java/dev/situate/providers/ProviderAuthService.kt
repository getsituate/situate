package dev.situate.providers

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class ProviderAuthService : Service() {
    internal var attemptId: String? = null
        private set

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val id = intent?.getStringExtra(ProviderAuthCoordinator.ATTEMPT)
        if (id == null || !ProviderAuthCoordinator.matches(id)) {
            if (!ProviderAuthCoordinator.hasOwner()) stopSelfResult(startId)
            return START_NOT_STICKY
        }
        if (intent.action == ProviderAuthCoordinator.CANCEL + id) {
            ProviderAuthCoordinator.requestExit(id, "cancelled")
            return START_NOT_STICKY
        }
        if (intent.action != ProviderAuthCoordinator.START || attemptId == id) return START_NOT_STICKY
        attemptId = id
        try {
            val notification = notification(id)
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            ProviderAuthCoordinator.promoted(this, id)
        } catch (_: Exception) {
            ProviderAuthCoordinator.startupFailed(id)
            endForeground()
        }
        return START_NOT_STICKY
    }

    private fun notification(id: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        val builder =
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, getString(R.string.situate_provider_auth_channel), NotificationManager.IMPORTANCE_LOW),
                )
                Notification.Builder(this, CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
        // PendingIntent identity excludes extras; distinct actions fence old notification buttons.
        val cancel =
            Intent(this, ProviderAuthService::class.java)
                .setAction(ProviderAuthCoordinator.CANCEL + id)
                .putExtra(ProviderAuthCoordinator.ATTEMPT, id)
        val action = PendingIntent.getService(this, 0, cancel, PendingIntent.FLAG_IMMUTABLE)
        builder
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(getString(R.string.situate_provider_auth_title))
            .setContentText(getString(R.string.situate_provider_auth_body))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, getString(R.string.situate_provider_auth_cancel), action).build())
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.action = "dev.situate.providers.AUTH_RETURN.$id"
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
        }
        return builder.build()
    }

    internal fun endForeground() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        attemptId?.let { ProviderAuthCoordinator.requestExit(it, "cancelled") }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        ProviderAuthCoordinator.destroyed(this, attemptId)
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "situate-provider-auth"
        private const val NOTIFICATION_ID = 0x53415554
    }
}

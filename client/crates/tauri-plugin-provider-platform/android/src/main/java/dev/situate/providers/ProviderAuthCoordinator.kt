package dev.situate.providers

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper

internal object ProviderAuthCoordinator {
    const val ATTEMPT = "attemptId"
    const val START = "dev.situate.providers.AUTH_START"
    const val CANCEL = "dev.situate.providers.AUTH_CANCEL."
    private val owner = AuthAttemptOwner()
    private val handler = Handler(Looper.getMainLooper())
    private var service: ProviderAuthService? = null
    private var startup: Runnable? = null
    private var deadline: Runnable? = null

    fun matches(id: String): Boolean = owner.matches(id)

    fun hasOwner(): Boolean = owner.id != null

    fun start(
        context: Context,
        id: String,
        onReady: () -> Unit,
        onStartFailure: () -> Unit,
        onExit: (String) -> Unit,
    ): Boolean {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (!owner.reserve(id, onReady, onStartFailure, onExit)) return false
        startup = Runnable { if (!owner.isReady(id)) finish(id) }.also { handler.postDelayed(it, 4_000) }
        deadline = Runnable { requestExit(id, "failed") }.also { handler.postDelayed(it, 300_000) }
        try {
            val intent = Intent(context, ProviderAuthService::class.java).setAction(START).putExtra(ATTEMPT, id)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        } catch (_: Exception) {
            finish(id)
        }
        return true
    }

    fun promoted(
        instance: ProviderAuthService,
        id: String,
    ) {
        if (!owner.matches(id)) return
        service = instance
        startup?.let(handler::removeCallbacks)
        startup = null
        owner.ready(id)
    }

    fun startupFailed(id: String) {
        finish(id)
    }

    fun requestExit(
        id: String,
        kind: String,
    ) {
        if (!owner.matches(id)) return
        if (!owner.isReady(id)) {
            finish(id)
            return
        }
        owner.requestExit(id, kind)
    }

    fun finish(id: String) {
        if (!owner.finish(id)) return
        startup?.let(handler::removeCallbacks)
        deadline?.let(handler::removeCallbacks)
        startup = null
        deadline = null
        val active = service
        service = null
        if (active?.attemptId == id) active.endForeground()
    }

    fun destroyed(
        instance: ProviderAuthService,
        id: String?,
    ) {
        if (service === instance) service = null
        if (id != null) owner.requestExit(id, "failed")
    }
}

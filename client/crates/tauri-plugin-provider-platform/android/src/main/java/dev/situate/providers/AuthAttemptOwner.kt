package dev.situate.providers

internal class AuthAttemptOwner {
    private class Attempt(
        val id: String,
        var onReady: (() -> Unit)?,
        var onStartFailure: (() -> Unit)?,
        val onExit: (String) -> Unit,
        var ready: Boolean = false,
        var exitSent: Boolean = false,
    )

    private var current: Attempt? = null
    val id: String? get() = current?.id

    fun matches(id: String): Boolean = current?.id == id

    fun isReady(id: String): Boolean = current?.let { it.id == id && it.ready } == true

    fun reserve(
        id: String,
        onReady: () -> Unit,
        onStartFailure: () -> Unit,
        onExit: (String) -> Unit,
    ): Boolean {
        if (current != null) return false
        current = Attempt(id, onReady, onStartFailure, onExit)
        return true
    }

    fun ready(id: String) {
        val attempt = current?.takeIf { it.id == id && !it.ready } ?: return
        attempt.ready = true
        val callback = attempt.onReady
        attempt.onReady = null
        attempt.onStartFailure = null
        callback?.invoke()
    }

    fun requestExit(
        id: String,
        kind: String,
    ) {
        val attempt = current?.takeIf { it.id == id && !it.exitSent } ?: return
        if (!attempt.ready) {
            finish(id)
            return
        }
        attempt.exitSent = true
        attempt.onExit(kind)
    }

    fun finish(id: String): Boolean {
        val attempt = current?.takeIf { it.id == id } ?: return false
        current = null
        attempt.onStartFailure?.invoke()
        return true
    }
}

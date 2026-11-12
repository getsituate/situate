package dev.situate.providers

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal object ProviderAuthNativeBridge {
    @JvmStatic external fun register(): Boolean

    @JvmStatic
    fun finish(attemptId: String): Boolean {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            ProviderAuthCoordinator.finish(attemptId)
            return true
        }
        val completed = CountDownLatch(1)
        val failed = AtomicBoolean(false)
        val posted =
            Handler(Looper.getMainLooper()).post {
                try {
                    ProviderAuthCoordinator.finish(attemptId)
                } catch (_: Exception) {
                    failed.set(true)
                } finally {
                    completed.countDown()
                }
            }
        // Timeout limits the acknowledgement wait, not the queued idempotent cleanup.
        return posted && completed.await(5, TimeUnit.SECONDS) && !failed.get()
    }
}

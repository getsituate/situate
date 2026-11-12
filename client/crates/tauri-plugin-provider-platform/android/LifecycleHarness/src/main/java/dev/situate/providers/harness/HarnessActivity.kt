package dev.situate.providers.harness

import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.situate.providers.ProviderAuthCoordinator
import dev.situate.providers.ProviderAuthNativeBridge
import dev.situate.providers.ProviderAuthService
import dev.situate.providers.ProviderKeyStore
import dev.situate.providers.ProviderPolicy
import dev.situate.providers.StoreFailure
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID

object NativeLoopback {
    init {
        System.loadLibrary("android_provider_lifecycle")
    }

    external fun start(): Int

    external fun stop()

    external fun callbacks(): Int

    external fun exitRequested()

    external fun finishAuth(id: String): Boolean
}

class HarnessActivity : Activity() {
    private lateinit var status: TextView
    private var finishAfterDestroy = false

    private fun event(kind: String) {
        val entry =
            JSONObject()
                .put("kind", kind)
                .put("timeMs", System.currentTimeMillis())
                .put("pid", Process.myPid())
                .put("callbacks", NativeLoopback.callbacks())
        synchronized(this) { File(filesDir, "activity-events.jsonl").appendText("$entry\n") }
    }

    private fun result(message: String) {
        event(message)
        runOnUiThread { status.text = message }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(30, 70, 30, 30)
            }
        status =
            TextView(this).apply {
                text = "Provider platform tests"
                textSize = 22f
            }
        layout.addView(status)
        listOf("create", "verify", "browser", "cancel", "finish").forEach { action ->
            layout.addView(
                Button(this).apply {
                    text = action
                    setOnClickListener { action(action) }
                },
            )
        }
        setContentView(layout)
        NativeLoopback.callbacks()
        check(ProviderAuthNativeBridge.register())
        event("created")
        intent.getStringExtra("action")?.let(::action)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("action")?.let(::action)
    }

    override fun onResume() {
        super.onResume()
        event("resumed")
    }

    override fun onStop() {
        event("stopped")
        super.onStop()
    }

    override fun onDestroy() {
        event("activity destroyed")
        super.onDestroy()
        if (finishAfterDestroy) {
            Thread {
                Thread.sleep(10_000)
                NativeLoopback.stop()
                check(NativeLoopback.finishAuth(File(filesDir, "attempt.txt").readText()))
                event("native finish after activity destruction acknowledged")
            }.start()
        }
    }

    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun alias(account: String) = "${ProviderPolicy.SERVICE}:${digest(account.toByteArray(Charsets.UTF_8))}"

    private fun action(action: String) {
        when (action) {
            "create" ->
                Thread {
                    val store = ProviderKeyStore(this)
                    val metadata = File(noBackupFilesDir, "synthetic-account.json")
                    if (metadata.exists()) {
                        result("failed: pending synthetic account")
                        return@Thread
                    }
                    val account = "synthetic-android:${UUID.randomUUID()}"
                    val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
                    var persisted = false
                    try {
                        metadata.writeText(
                            JSONObject()
                                .put("account", account)
                                .put("digest", digest(key))
                                .put("pid", Process.myPid())
                                .toString(),
                        )
                        store.set(account, key)
                        check(store.get(account).contentEquals(key))
                        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                        check(keystore.getKey(alias(account), null).encoded == null)
                        persisted = true
                        result("passed: created random32 roundtrip with nonexportable wrapping key")
                    } catch (error: Exception) {
                        result("failed: create ${error.javaClass.simpleName}")
                    } finally {
                        key.fill(0)
                        if (!persisted) {
                            try {
                                store.delete(account)
                                metadata.delete()
                            } catch (
                                _: Exception,
                            ) {
                                result("failed: create cleanup")
                            }
                        }
                    }
                }.start()
            "verify" ->
                Thread {
                    val store = ProviderKeyStore(this)
                    val metadata = File(noBackupFilesDir, "synthetic-account.json")
                    var account: String? = null
                    try {
                        val data = JSONObject(metadata.readText())
                        account = data.getString("account")
                        check(data.getInt("pid") != Process.myPid())
                        val value = store.get(account)
                        check(digest(value) == data.getString("digest"))
                        value.fill(0)
                        store.delete(account)
                        val missing =
                            try {
                                store.get(account)
                                false
                            } catch (error: StoreFailure) {
                                error.reason == "missing"
                            }
                        check(missing)
                        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                        check(!keystore.containsAlias(alias(account)))
                        check(metadata.delete())
                        result("passed: restart read equality delete missing and alias cleanup")
                    } catch (error: Exception) {
                        result("failed: verify ${error.javaClass.simpleName}")
                    } finally {
                        account?.let {
                            try {
                                store.delete(it)
                                metadata.delete()
                            } catch (_: Exception) {
                                result("failed: verify cleanup")
                            }
                        }
                    }
                }.start()
            "prepare-channel" -> {
                val id = UUID.randomUUID().toString()
                check(NativeLoopback.start() != 0)
                check(
                    ProviderAuthCoordinator.start(
                        applicationContext,
                        id,
                        onReady = {
                            Handler(Looper.getMainLooper()).postDelayed({
                                Thread {
                                    NativeLoopback.stop()
                                    check(NativeLoopback.finishAuth(id))
                                    result("channel prepared")
                                }.start()
                            }, 1_000)
                        },
                        onStartFailure = { result("failed: channel preparation") },
                        onExit = {},
                    ),
                )
            }
            "fgs-browser", "fgs-blocked-browser", "fgs-destroy-browser" -> {
                val manager = getSystemService(NotificationManager::class.java)
                val id = UUID.randomUUID().toString()
                File(filesDir, "attempt.txt").writeText(id)
                File(filesDir, "rust-events.jsonl").delete()
                val port = NativeLoopback.start()
                check(port != 0)
                val url = "http://127.0.0.1:$port/start"
                File(filesDir, "fixture-url.txt").writeText(url)
                check(
                    ProviderAuthCoordinator.start(
                        applicationContext,
                        id,
                        onReady = {
                            event("foreground ready")
                            val importance = manager.getNotificationChannel(ProviderAuthService.CHANNEL_ID)?.importance
                            event("notifications enabled=${manager.areNotificationsEnabled()} channel=$importance")
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            Handler(Looper.getMainLooper()).postDelayed({
                                if (action == "fgs-destroy-browser") {
                                    finishAfterDestroy = true
                                    finishAndRemoveTask()
                                    return@postDelayed
                                }
                                val actionIntent =
                                    manager.activeNotifications
                                        .firstOrNull {
                                            it.notification.channelId ==
                                                ProviderAuthService.CHANNEL_ID
                                        }?.notification
                                        ?.actions
                                        ?.firstOrNull()
                                        ?.actionIntent
                                if (manager.areNotificationsEnabled() && importance != NotificationManager.IMPORTANCE_NONE &&
                                    actionIntent != null
                                ) {
                                    event("notification PendingIntent cancel")
                                    actionIntent.send()
                                } else {
                                    event("native cancellation with suppressed drawer")
                                    ProviderAuthCoordinator.requestExit(id, "cancelled")
                                }
                            }, 55_000)
                        },
                        onStartFailure = { result("failed: foreground startup") },
                        onExit = { kind ->
                            NativeLoopback.exitRequested()
                            event("foreground exit $kind")
                        },
                    ),
                )
            }
            "browser" -> {
                File(filesDir, "rust-events.jsonl").delete()
                val port = NativeLoopback.start()
                if (port == 0) {
                    result("failed: loopback startup")
                    return
                }
                val url = "http://127.0.0.1:$port/start"
                File(filesDir, "fixture-url.txt").writeText(url)
                event("browser requested")
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            "cancel" ->
                Thread {
                    NativeLoopback.stop()
                    result(
                        if (NativeLoopback.callbacks() ==
                            0
                        ) {
                            "passed: cancelled without callback"
                        } else {
                            "failed: callback preceded cancellation"
                        },
                    )
                }.start()
            "finish" ->
                Thread {
                    NativeLoopback.stop()
                    val attempt = File(filesDir, "attempt.txt")
                    if (attempt.exists()) check(NativeLoopback.finishAuth(attempt.readText()))
                    result(
                        if (NativeLoopback.callbacks() ==
                            1
                        ) {
                            "passed: delayed callback observed on return"
                        } else {
                            "failed: delayed callback absent"
                        },
                    )
                }.start()
        }
    }
}

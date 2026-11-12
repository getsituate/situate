package dev.situate.providers

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors

@InvokeArg
class StoreArgs {
    var operation: String = ""
    var account: String = ""
    var key: String? = null
}

@InvokeArg
class BrowserArgs {
    var url: String = ""
}

@InvokeArg
class AuthBrowserArgs {
    var url: String = ""
    var attemptId: String = ""
    lateinit var events: Channel
}

@InvokeArg
class FinishAuthBrowserArgs {
    var attemptId: String = ""
}

@TauriPlugin(permissions = [Permission(strings = ["android.permission.ACCESS_LOCAL_NETWORK"], alias = "localNetwork")])
class ProviderPlatformPlugin(
    private val activity: Activity,
) : Plugin(activity) {
    private val finishBridgeReady = ProviderAuthNativeBridge.register()

    companion object {
        // A shared serial queue also covers activity/plugin recreation during browser handoff.
        private val io =
            Executors.newSingleThreadExecutor { task ->
                Thread(task, "situate-provider-keys").apply { isDaemon = true }
            }
    }

    @Command
    fun store(invoke: Invoke) {
        val args =
            try {
                invoke.parseArgs(StoreArgs::class.java)
            } catch (_: Exception) {
                invoke.reject("native.ai.secureStore.invalid")
                return
            }
        io.execute {
            try {
                val store = ProviderKeyStore(activity.applicationContext)
                val result = JSObject()
                when (args.operation) {
                    "availability" -> store.availability()
                    "directory" -> result.put("path", store.directory().absolutePath)
                    "get" -> {
                        val key = store.get(args.account)
                        try {
                            result.put("key", Base64.encodeToString(key, Base64.NO_WRAP))
                        } finally {
                            key.fill(0)
                        }
                    }
                    "set" -> {
                        val key =
                            try {
                                Base64.decode(args.key ?: throw StoreFailure("invalid"), Base64.NO_WRAP)
                            } catch (
                                _: IllegalArgumentException,
                            ) {
                                throw StoreFailure("invalid")
                            }
                        try {
                            store.set(args.account, key)
                        } finally {
                            key.fill(0)
                        }
                    }
                    "delete" -> store.delete(args.account)
                    else -> throw StoreFailure("invalid")
                }
                invoke.resolve(result)
            } catch (error: Exception) {
                invoke.reject(ProviderPolicy.error(error))
            }
        }
    }

    @Command
    fun requestLocalNetwork(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < 37 || activity.applicationInfo.targetSdkVersion < 37 ||
            getPermissionState("localNetwork") == PermissionState.GRANTED
        ) {
            invoke.resolve(JSObject())
            return
        }
        requestPermissionForAlias("localNetwork", invoke, "localNetworkResult")
    }

    @PermissionCallback
    fun localNetworkResult(invoke: Invoke) {
        if (getPermissionState("localNetwork") == PermissionState.GRANTED) {
            invoke.resolve(JSObject())
        } else {
            invoke.reject("native.ai.permission.localNetworkDenied")
        }
    }

    @Command
    fun openAuthBrowser(invoke: Invoke) {
        val args =
            try {
                invoke.parseArgs(AuthBrowserArgs::class.java)
            } catch (_: Exception) {
                invoke.reject("native.ai.browser.invalidUrl")
                return
            }
        if (!ProviderPolicy.browser(args.url) || args.attemptId.isEmpty() || args.attemptId.toByteArray().size > 128 ||
            args.attemptId.any { Character.isISOControl(it) }
        ) {
            invoke.reject("native.ai.browser.invalidUrl")
            return
        }
        activity.runOnUiThread {
            if (!finishBridgeReady || activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) {
                invoke.reject("native.ai.browser.openFailed")
                return@runOnUiThread
            }
            val accepted =
                ProviderAuthCoordinator.start(
                    activity.applicationContext,
                    args.attemptId,
                    onReady = {
                        try {
                            if (activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus()) throw IllegalStateException()
                            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)).addCategory(Intent.CATEGORY_BROWSABLE))
                            invoke.resolve(JSObject())
                        } catch (_: Exception) {
                            ProviderAuthCoordinator.finish(args.attemptId)
                            invoke.reject("native.ai.browser.openFailed")
                        }
                    },
                    onStartFailure = { invoke.reject("native.ai.browser.openFailed") },
                    onExit = { kind ->
                        args.events.send(
                            JSObject().apply {
                                put("attemptId", args.attemptId)
                                put("kind", kind)
                            },
                        )
                    },
                )
            if (!accepted) invoke.reject("native.ai.browser.busy")
        }
    }

    @Command
    fun finishAuthBrowser(invoke: Invoke) {
        val args =
            try {
                invoke.parseArgs(FinishAuthBrowserArgs::class.java)
            } catch (_: Exception) {
                invoke.reject("native.ai.browser.openFailed")
                return
            }
        activity.runOnUiThread {
            ProviderAuthCoordinator.finish(args.attemptId)
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun openBrowser(invoke: Invoke) {
        val args =
            try {
                invoke.parseArgs(BrowserArgs::class.java)
            } catch (_: Exception) {
                invoke.reject("native.ai.browser.invalidUrl")
                return
            }
        if (!ProviderPolicy.browser(args.url)) {
            invoke.reject("native.ai.browser.invalidUrl")
            return
        }
        activity.runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(args.url)).addCategory(Intent.CATEGORY_BROWSABLE)
                activity.startActivity(intent)
                invoke.resolve(JSObject())
            } catch (_: Exception) {
                invoke.reject("native.ai.browser.openFailed")
            }
        }
    }
}

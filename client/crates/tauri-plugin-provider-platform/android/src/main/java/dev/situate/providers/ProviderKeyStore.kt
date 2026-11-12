package dev.situate.providers

import android.content.Context
import android.os.Build
import android.os.UserManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.system.Os
import android.system.OsConstants
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class StoreFailure(
    val reason: String,
) : Exception()

internal object ProviderPolicy {
    const val SERVICE = "dev.situate.provider-wrapping-key.v1"

    fun account(account: String) {
        if (account.isEmpty() || account.toByteArray(Charsets.UTF_8).size > 240 || account.any { Character.isISOControl(it) }) {
            throw StoreFailure("invalid")
        }
    }

    fun key(key: ByteArray) {
        if (key.size != 32) throw StoreFailure("invalid")
    }

    fun browser(raw: String): Boolean {
        val uri =
            try {
                java.net.URI(raw)
            } catch (_: Exception) {
                return false
            }
        if (uri.scheme != "https" || uri.port != -1 || uri.userInfo != null || uri.fragment != null) return false
        return when (uri.host) {
            "auth.openai.com" -> uri.rawPath in setOf("/api/accounts/authorize", "/oauth/authorize", "/codex/device")
            "openrouter.ai" -> uri.rawPath == "/auth"
            else -> false
        }
    }

    fun error(error: Exception): String =
        "native.ai.secureStore." +
            when (error) {
                is StoreFailure -> error.reason
                is UserNotAuthenticatedException -> "locked"
                is KeyPermanentlyInvalidatedException -> "missing"
                is SecurityException -> "locked"
                is javax.crypto.AEADBadTagException -> "invalid"
                else -> "failed"
            }
}

internal class ProviderKeyStore(
    private val context: Context,
) {
    private fun store(): KeyStore =
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        } catch (_: Exception) {
            throw StoreFailure("unavailable")
        }

    fun availability() {
        if (context.getSystemService(UserManager::class.java)?.isUserUnlocked != true) {
            throw StoreFailure("locked")
        }
        store()
    }

    fun directory(): File = privateDirectory("provider-credentials")

    private fun syncDirectory(directory: File) {
        val closeOnExec = if (Build.VERSION.SDK_INT >= 27) OsConstants.O_CLOEXEC else 0
        val descriptor = Os.open(directory.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or closeOnExec, 0)
        try {
            if (!OsConstants.S_ISDIR(Os.fstat(descriptor).st_mode)) throw StoreFailure("failed")
            Os.fsync(descriptor)
        } finally {
            Os.close(descriptor)
        }
    }

    private fun privateDirectory(name: String): File {
        val parent = context.noBackupFilesDir
        val directory = File(parent, name)
        if (!directory.isDirectory && !directory.mkdirs()) throw StoreFailure("failed")
        // Also persist newly created directory entries, including Android's no-backup directory.
        syncDirectory(directory)
        syncDirectory(parent)
        syncDirectory(parent.parentFile ?: throw StoreFailure("failed"))
        return directory
    }

    private fun id(account: String): String {
        ProviderPolicy.account(account)
        return MessageDigest
            .getInstance("SHA-256")
            .digest(account.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun file(id: String): AtomicFile {
        val root = privateDirectory("provider-wrapping-keys")
        return AtomicFile(File(root, id))
    }

    private fun alias(id: String) = "${ProviderPolicy.SERVICE}:$id"

    private fun wrappingKey(
        id: String,
        create: Boolean,
    ): SecretKey {
        val store = store()
        val existing = store.getKey(alias(id), null)
        if (existing != null) return existing as? SecretKey ?: throw StoreFailure("invalid")
        if (!create) throw StoreFailure("missing")
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec
                .Builder(alias(id), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun aad(account: String) = "${ProviderPolicy.SERVICE}:$account".toByteArray(Charsets.UTF_8)

    fun get(account: String): ByteArray {
        val id = id(account)
        val record = file(id)
        val bytes =
            try {
                record.readFully()
            } catch (_: java.io.FileNotFoundException) {
                throw StoreFailure("missing")
            }
        if (bytes.size != 61 || bytes[0] != 1.toByte()) throw StoreFailure("invalid")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(id, false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD(aad(account))
        return cipher.doFinal(bytes.copyOfRange(13, bytes.size)).also { ProviderPolicy.key(it) }
    }

    fun set(
        account: String,
        key: ByteArray,
    ) {
        ProviderPolicy.key(key)
        val id = id(account)
        val record = file(id)
        // Recover an interrupted AtomicFile write before deciding whether key creation is safe.
        val exists =
            try {
                record.openRead().use { }
                true
            } catch (_: java.io.FileNotFoundException) {
                false
            }
        if (exists) get(account).fill(0)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(id, !exists))
        cipher.updateAAD(aad(account))
        val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(key)
        val output = record.startWrite()
        try {
            output.write(bytes)
            output.fd.sync()
        } catch (error: Exception) {
            record.failWrite(output)
            throw error
        }
        record.finishWrite(output)
        // AtomicFile can log a failed rename without throwing; it does not fsync the parent.
        if (!record.readFully().contentEquals(bytes)) throw StoreFailure("failed")
        // A failure after rename is uncertain persistence, not permission to roll back the record.
        syncDirectory(record.baseFile.parentFile ?: throw StoreFailure("failed"))
    }

    fun delete(account: String) {
        val id = id(account)
        val record = file(id)
        record.delete()
        if (listOf(record.baseFile, File(record.baseFile.path + ".bak"), File(record.baseFile.path + ".new")).any { it.exists() }) {
            throw StoreFailure("failed")
        }
        // Do not destroy the wrapping key while an unpersisted unlink could still be rolled back.
        syncDirectory(record.baseFile.parentFile ?: throw StoreFailure("failed"))
        store().deleteEntry(alias(id))
    }
}

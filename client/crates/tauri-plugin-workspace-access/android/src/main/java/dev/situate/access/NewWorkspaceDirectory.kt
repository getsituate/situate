package dev.situate.access

import android.os.ParcelFileDescriptor
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.Closeable
import java.io.File

// Linux O_CLOEXEC is 0x80000 on ARM and x86 (32/64-bit); OsConstants exposes it only from API 27.
private const val OPEN_CLOSE_ON_EXEC = 0x80000

internal fun nativeText(
    key: String,
    params: org.json.JSONObject,
): String =
    org.json
        .JSONObject()
        .put("key", key)
        .put("params", params)
        .toString()

internal fun nativeError(
    key: String,
    path: String,
    error: Exception,
): String {
    val message = error.message?.takeIf { it.startsWith("native.") || it.startsWith("{") } ?: "native.provider.content.failed"
    return nativeText(
        key,
        org.json
            .JSONObject()
            .put("path", path)
            .put("error", message),
    )
}

internal class DirectoryHandle(
    path: File,
) : Closeable {
    private val descriptor: ParcelFileDescriptor

    init {
        val fd = Os.open(path.path, OsConstants.O_RDONLY or OsConstants.O_NONBLOCK or OsConstants.O_NOFOLLOW or OPEN_CLOSE_ON_EXEC, 0)
        try {
            check(OsConstants.S_ISDIR(Os.fstat(fd).st_mode)) { "native.provider.folder.notDirectory" }
            descriptor = ParcelFileDescriptor.dup(fd)
        } finally {
            Os.close(fd)
        }
    }

    private val identity = Os.fstat(descriptor.fileDescriptor)

    // android.system.Os does not expose mkdirat/openat. Procfs anchors these
    // single-component operations to a held descriptor, not its former pathname.
    val path: File get() = File("/proc/self/fd/${descriptor.fd}")

    fun requireAt(path: File) {
        val current = Os.lstat(path.path)
        check(OsConstants.S_ISDIR(current.st_mode) && current.st_dev == identity.st_dev && current.st_ino == identity.st_ino) {
            "native.workspace.create.locationChanged"
        }
    }

    fun publishNoReplace(
        source: String,
        target: String,
    ) = WorkspacePublication.publish(descriptor.fd, source, target)

    fun sync() = Os.fsync(descriptor.fileDescriptor)

    override fun close() = descriptor.close()
}

internal class NewWorkspaceDirectory(
    private val parentPath: File,
    private val name: String,
) : Closeable {
    private val parent = DirectoryHandle(parentPath)
    private val child: DirectoryHandle
    val path = File(parentPath, name)

    init {
        var created = false
        try {
            Os.mkdir(File(parent.path, name).path, OsConstants.S_IRWXU)
            created = true
            child = DirectoryHandle(File(parent.path, name))
        } catch (e: Exception) {
            parent.close()
            if (created) error(partial(e))
            if (e is ErrnoException && e.errno == OsConstants.EEXIST) error("native.workspace.folder.exists")
            error("native.provider.folder.createFailed")
        }
    }

    fun initialize() {
        requireCurrent()
        // There is no atomic mkdir-and-open API. This rejects nonempty directories
        // swapped in before handle acquisition; later writes stay on the held child.
        check(child.path.list()?.isEmpty() == true) { "native.provider.folder.notInitialized" }
        Os.mkdir(File(child.path, ".situate").path, OsConstants.S_IRWXU)
        check(WorkspaceIdentity.admit(File(child.path, ".")) != null) { "native.workspace.create.markerFailed" }
        child.sync()
        parent.sync()
        requireCurrent()
    }

    fun requireCurrent() {
        parent.requireAt(parentPath)
        child.requireAt(File(parent.path, name))
    }

    fun partial(error: Exception) = nativeError("native.provider.folder.partial", path.path, error)

    override fun close() {
        try {
            child.close()
        } finally {
            parent.close()
        }
    }
}

internal object WorkspaceIdentity {
    fun validate(bytes: ByteArray): String? =
        try {
            if (bytes.size > 1024) {
                null
            } else {
                val text =
                    Charsets.UTF_8
                        .newDecoder()
                        .decode(java.nio.ByteBuffer.wrap(bytes))
                        .toString()
                check(!text.contains('\\'))
                android.util.JsonReader(java.io.StringReader(text)).use { reader ->
                    val keys = mutableSetOf<String>()
                    var id: String? = null
                    reader.beginObject()
                    while (reader.hasNext()) {
                        val key = reader.nextName()
                        check(keys.add(key))
                        when (key) {
                            "version" -> {
                                check(reader.peek() == android.util.JsonToken.NUMBER)
                                check(reader.nextString() == "1")
                            }
                            "id" -> {
                                check(reader.peek() == android.util.JsonToken.STRING)
                                id = reader.nextString()
                            }
                            else -> error("invalid metadata")
                        }
                    }
                    reader.endObject()
                    check(reader.peek() == android.util.JsonToken.END_DOCUMENT)
                    id?.takeIf {
                        keys == setOf("version", "id") &&
                            Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}").matches(it)
                    }
                }
            }
        } catch (_: Exception) {
            null
        }

    fun bytes(): ByteArray = "{\"version\":1,\"id\":\"${java.util.UUID.randomUUID()}\"}\n".toByteArray(Charsets.UTF_8)

    private fun read(marker: DirectoryHandle): String? {
        val fd =
            Os.open(
                File(marker.path, "workspace.json").path,
                OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW or OsConstants.O_NONBLOCK or OPEN_CLOSE_ON_EXEC,
                0,
            )
        try {
            val info = Os.fstat(fd)
            if (!OsConstants.S_ISREG(info.st_mode) || info.st_size > 1024) return null
            val bytes = ByteArray(1025)
            var count = 0
            while (count < bytes.size) {
                val length = Os.read(fd, bytes, count, bytes.size - count)
                if (length == 0) break
                count += length
            }
            return validate(bytes.copyOf(count))
        } finally {
            Os.close(fd)
        }
    }

    fun admit(root: File): String? {
        return try {
            DirectoryHandle(root).use { directory ->
                DirectoryHandle(File(directory.path, ".situate")).use { marker ->
                    val target = File(marker.path, "workspace.json")
                    try {
                        Os.lstat(target.path)
                        return read(marker)
                    } catch (e: ErrnoException) {
                        if (e.errno != OsConstants.ENOENT) throw e
                    }
                    if (Os.stat(directory.path.path).st_mode and 0x92 == 0 || Os.stat(marker.path.path).st_mode and 0x92 == 0) {
                        return null
                    }
                    val temporary = File(marker.path, ".workspace-${java.util.UUID.randomUUID()}.tmp")
                    val fd =
                        Os.open(
                            temporary.path,
                            OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_NOFOLLOW or
                                OPEN_CLOSE_ON_EXEC,
                            0x180,
                        )
                    var published = false
                    try {
                        try {
                            val bytes = bytes()
                            var count = 0
                            while (count < bytes.size) {
                                val length = Os.write(fd, bytes, count, bytes.size - count)
                                check(length > 0)
                                count += length
                            }
                            Os.fsync(fd)
                        } finally {
                            Os.close(fd)
                        }
                        try {
                            marker.publishNoReplace(temporary.name, target.name)
                            published = true
                        } catch (e: ErrnoException) {
                            if (e.errno != OsConstants.EEXIST) throw e
                        }
                        marker.sync()
                        read(marker)
                    } finally {
                        if (!published) Os.remove(temporary.path)
                    }
                }
            }
        } catch (_: Exception) {
            null
        }
    }
}

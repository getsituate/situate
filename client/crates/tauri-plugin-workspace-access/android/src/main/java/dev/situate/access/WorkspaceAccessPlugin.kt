package dev.situate.access

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import android.provider.DocumentsContract as Documents

@InvokeArg
class AccessLocation {
    var id: String = ""
    var name: String = ""
    var display: String = ""
    var kind: String = ""
    var handle: String = ""
}

@InvokeArg
class AccessArgs {
    var operation: String = ""
    var location: AccessLocation? = null
    var name: String = ""
}

@InvokeArg
class ContentArgs {
    var operation: String = ""
    var location: AccessLocation? = null
    var path: String = ""
    var text: String = ""
}

@TauriPlugin
class WorkspaceAccessPlugin(
    private val activity: Activity,
) : Plugin(activity) {
    companion object {
        // Tauri dispatches commands and activity results on the UI thread. Share one
        // process-lifetime queue across plugin instances, including activity recreation.
        private val contentIo =
            Executors.newCachedThreadPool { task ->
                Thread(task, "situate-workspace-content").apply { isDaemon = true }
            }
        private val io =
            Executors.newSingleThreadExecutor { task ->
                Thread(task, "situate-workspace-access").apply { isDaemon = true }
            }
    }

    override fun load(webView: WebView) {
        fitContent(activity)
    }

    override fun onResume(activity: AppCompatActivity) {
        fitContent(activity)
    }

    @Suppress("DEPRECATION") // adjustResize is required for IME insets before Android 11.
    private fun fitContent(activity: Activity) {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        fitWebContentToInsets(activity.findViewById(android.R.id.content))
    }

    private val resolver get() = activity.contentResolver
    private var picking = false
    private val grants = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    @Command
    fun content(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ContentArgs::class.java)
            contentIo.execute {
                try {
                    if (args.operation == "deviceLocale") {
                        val locale = java.util.Locale.getDefault()
                        val date = java.text.DateFormat.getDateInstance(java.text.DateFormat.SHORT, locale) as? java.text.SimpleDateFormat
                        val number = java.text.DecimalFormatSymbols.getInstance(locale)
                        invoke.resolve(
                            JSObject()
                                .put(
                                    "language",
                                    activity.resources.configuration.locales[0]
                                        .toLanguageTag(),
                                ).put(
                                    "time",
                                    if (android.text.format.DateFormat
                                            .is24HourFormat(activity)
                                    ) {
                                        "HH:mm"
                                    } else {
                                        "h:mm a"
                                    },
                                ).put("date", date?.toPattern() ?: "")
                                .put("decimal", number.decimalSeparator.toString())
                                .put("group", number.groupingSeparator.toString()),
                        )
                        return@execute
                    }
                    if (args.operation == "export") error("native.provider.export.unsupported")
                    val location = args.location ?: error("native.provider.workspace.unavailable")
                    if (args.operation == "localRoot") {
                        check(location.kind == "android-documents") { "native.provider.localRoot.unsupported" }
                        val folder = File(documents().canonicalFile, location.handle).canonicalFile
                        fileLocation(folder)
                        check(folder.isDirectory && folder.canRead()) { "native.files.workspace.folderUnavailable" }
                        invoke.resolve(JSObject().put("path", folder.path))
                        return@execute
                    }
                    if (args.operation == "openExternal" && args.path.startsWith("http")) {
                        val url = Uri.parse(args.path)
                        check(
                            url.scheme in listOf("http", "https") && !url.host.isNullOrBlank() && url.userInfo == null,
                        ) { "native.files.link.httpOnly" }
                        activity.runOnUiThread {
                            try {
                                activity.startActivity(Intent(Intent.ACTION_VIEW, url))
                                invoke.resolve(JSObject())
                            } catch (
                                e: Exception,
                            ) {
                                invoke.reject("native.provider.link.openFailed")
                            }
                        }
                        return@execute
                    }
                    val content =
                        if (location.kind == "android-tree") {
                            val handle = JSONObject(location.handle)
                            val tree = Uri.parse(handle.getString("tree"))
                            val document = Uri.parse(handle.getString("document"))
                            check(
                                resolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission },
                            ) { "native.provider.access.lost" }
                            WorkspaceContent(resolver, tree, document)
                        } else {
                            null
                        }
                    when (args.operation) {
                        "localization" -> {
                            check(content != null) { "native.localization.storage" }
                            val bytes = content.localization()
                            val text =
                                bytes?.let {
                                    Charsets.UTF_8
                                        .newDecoder()
                                        .decode(java.nio.ByteBuffer.wrap(it))
                                        .toString()
                                }
                            invoke.resolve(JSObject().put("text", text ?: JSONObject.NULL))
                        }
                        "appearance" -> {
                            check(content != null) { "native.appearance.storage" }
                            val bytes = content.appearance()
                            val text =
                                bytes?.let {
                                    try {
                                        Charsets.UTF_8
                                            .newDecoder()
                                            .decode(java.nio.ByteBuffer.wrap(it))
                                            .toString()
                                    } catch (_: java.nio.charset.CharacterCodingException) {
                                        error("native.appearance.invalid")
                                    }
                                }
                            invoke.resolve(JSObject().put("text", text ?: JSONObject.NULL))
                        }
                        "list" -> {
                            check(content != null) { "native.provider.localStorage.required" }
                            val entries = org.json.JSONArray()
                            content
                                .list(
                                    args.path,
                                ).forEach { entries.put(JSONObject().put("name", it.name).put("directory", it.directory)) }
                            invoke.resolve(JSObject().put("entries", entries))
                        }
                        "read" -> {
                            check(content != null) { "native.provider.localStorage.required" }
                            val bytes = content.read(args.path, 16 * 1024 * 1024).bytes
                            invoke.resolve(JSObject().put("base64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
                        }
                        "openExternal" -> {
                            val uri =
                                if (content != null) {
                                    content.read(args.path, 16 * 1024 * 1024).document
                                } else {
                                    check(location.kind == "android-documents") { "native.files.workspace.handleUnsupported" }
                                    val root = File(documents().canonicalFile, location.handle).canonicalFile
                                    fileLocation(root)
                                    var target = root
                                    contentComponents(args.path).forEach { component ->
                                        target = File(target, component)
                                        check(!isLink(target)) { "native.provider.symlink.unsupported" }
                                    }
                                    check(
                                        target.isFile && target.canonicalPath.startsWith(root.path + File.separator),
                                    ) { "native.provider.file.outsideWorkspace" }
                                    androidx.core.content.FileProvider.getUriForFile(
                                        activity,
                                        activity.packageName + ".workspace-content",
                                        target,
                                    )
                                }
                            activity.runOnUiThread {
                                try {
                                    val intent =
                                        Intent(Intent.ACTION_VIEW)
                                            .setDataAndType(
                                                uri,
                                                resolver.getType(uri) ?: "application/octet-stream",
                                            ).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    intent.clipData = android.content.ClipData.newRawUri(args.path.substringAfterLast('/'), uri)
                                    activity.startActivity(intent)
                                    invoke.resolve(JSObject())
                                } catch (e: Exception) {
                                    invoke.reject("native.provider.file.openFailed")
                                }
                            }
                        }
                        else -> error("native.provider.operation.unknown")
                    }
                } catch (e: Exception) {
                    invoke.reject(e.message ?: "native.provider.content.failed")
                }
            }
        } catch (e: Exception) {
            invoke.reject(e.message ?: "native.provider.content.startFailed")
        }
    }

    @Command
    fun access(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AccessArgs::class.java)
            when (args.operation) {
                "diagnosticsDirectory" ->
                    io.execute {
                        try {
                            val directory = File(activity.noBackupFilesDir, "diagnostics")
                            check(directory.isDirectory || directory.mkdir())
                            DirectoryHandle(directory).use { it.requireAt(directory) }
                            val version =
                                android.os.Build.VERSION.RELEASE
                                    .take(32)
                                    .takeIf { Regex("[0-9]+(\\.[0-9]+)*").matches(it) }
                                    ?: "0"
                            invoke.resolve(JSObject().put("directory", directory.path).put("platformVersion", version))
                        } catch (_: Exception) {
                            invoke.reject("native.provider.documents.unavailable")
                        }
                    }
                "identity" ->
                    io.execute {
                        val identity =
                            try {
                                workspaceIdentity(args.location)
                            } catch (_: Exception) {
                                null
                            }
                        invoke.resolve(JSObject().put("workspaceId", identity ?: JSONObject.NULL))
                    }
                "pick" -> activity.runOnUiThread { presentPicker(invoke) }
                "background" ->
                    activity.runOnUiThread {
                        respond(invoke) {
                            activity.moveTaskToBack(true)
                            null
                        }
                    }
                else ->
                    io.execute {
                        respond(invoke) {
                            when (args.operation) {
                                "default" -> {
                                    val folder = activity.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                                    if (folder != null && folder.isDirectory && folder.canRead()) fileLocation(folder) else null
                                }
                                "inspect", "preflight", "create" -> operate(args)
                                else -> error("native.workspace.operation.unknownFolder")
                            }
                        }
                    }
            }
        } catch (e: Exception) {
            invoke.reject(e.message ?: "native.provider.folder.startFailed")
        }
    }

    private fun presentPicker(invoke: Invoke) {
        if (picking) {
            invoke.reject("native.provider.picker.alreadyOpen")
            return
        }
        picking = true
        try {
            val intent =
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    .addFlags(grants or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            startActivityForResult(invoke, intent, "picked")
        } catch (e: Exception) {
            picking = false
            invoke.reject(e.message ?: "native.provider.picker.openFailed")
        }
    }

    private fun respond(
        invoke: Invoke,
        operation: () -> JSObject?,
    ) {
        try {
            invoke.resolve(JSObject().put("location", operation()))
        } catch (e: SecurityException) {
            invoke.reject("native.provider.access.grantAgain")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "native.provider.folder.checkLocal")
        }
    }

    @ActivityCallback
    fun picked(
        invoke: Invoke,
        result: ActivityResult,
    ) {
        picking = false
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(JSObject())
            return
        }
        io.execute {
            respond(invoke) {
                check(result.resultCode == Activity.RESULT_OK) { "native.provider.picker.failed" }
                val data = result.data ?: error("native.provider.picker.noSelection")
                val tree = data.data ?: error("native.provider.picker.noSelection")
                check(data.flags and grants == grants) { "native.provider.workspace.writeRequired" }
                resolver.takePersistableUriPermission(tree, grants)
                val uri = Documents.buildDocumentUriUsingTree(tree, Documents.getTreeDocumentId(tree))
                treeLocation(tree, uri)
            }
        }
    }

    private data class Entry(
        val uri: Uri,
        val name: String,
        val mime: String,
        val flags: Int,
    )

    private fun entry(uri: Uri): Entry {
        val cols = arrayOf(Documents.Document.COLUMN_DISPLAY_NAME, Documents.Document.COLUMN_MIME_TYPE, Documents.Document.COLUMN_FLAGS)
        resolver.query(uri, cols, null, null, null)?.use { cursor ->
            check(cursor.moveToFirst()) { "native.provider.folder.makeLocal" }
            return Entry(uri, cursor.getString(0), cursor.getString(1), cursor.getInt(2))
        }
        error("native.provider.folder.unreadable")
    }

    private fun children(
        tree: Uri,
        uri: Uri,
    ): List<Entry> {
        val result = mutableListOf<Entry>()
        val query = Documents.buildChildDocumentsUriUsingTree(tree, Documents.getDocumentId(uri))
        val cols =
            arrayOf(
                Documents.Document.COLUMN_DOCUMENT_ID,
                Documents.Document.COLUMN_DISPLAY_NAME,
                Documents.Document.COLUMN_MIME_TYPE,
                Documents.Document.COLUMN_FLAGS,
            )
        val cursor =
            resolver.query(query, cols, null, null, null)
                ?: error("native.provider.folder.makeLocal")
        cursor.use {
            check(!it.extras.getBoolean(Documents.EXTRA_LOADING, false)) { "native.provider.folder.loading" }
            while (it.moveToNext()) {
                result.add(
                    Entry(Documents.buildDocumentUriUsingTree(tree, it.getString(0)), it.getString(1), it.getString(2), it.getInt(3)),
                )
            }
        }
        return result
    }

    private fun requireDirectory(e: Entry) {
        check(e.mime == Documents.Document.MIME_TYPE_DIR) { "native.provider.folder.chooseDirectory" }
        check(e.flags and Documents.Document.FLAG_VIRTUAL_DOCUMENT == 0) { "native.provider.folder.virtualUnsupported" }
        check(e.flags and Documents.Document.FLAG_DIR_SUPPORTS_CREATE != 0) { "native.provider.folder.creationUnsupported" }
    }

    private fun treeLocation(
        tree: Uri,
        uri: Uri,
        display: String? = null,
    ): JSObject {
        val e = entry(uri)
        requireDirectory(e)
        children(tree, uri)
        val id = Documents.getDocumentId(uri)
        val provider =
            activity.packageManager
                .resolveContentProvider(uri.authority ?: "", 0)
                ?.loadLabel(activity.packageManager)
                ?.toString() ?: "Files"
        val label =
            if (uri.authority == "com.android.externalstorage.documents") {
                val volume = id.substringBefore(':')
                val path = id.substringAfter(':', e.name)
                if (volume ==
                    "primary"
                ) {
                    nativeText("native.provider.storage.internalPath", JSONObject().put("path", path))
                } else {
                    "$volume / $path"
                }
            } else {
                display ?: "$provider / ${e.name}"
            }
        return JSObject()
            .put("id", "android:${uri.authority}:$id")
            .put("name", e.name)
            .put("display", label)
            .put("kind", "android-tree")
            .put("handle", JSONObject().put("tree", tree.toString()).put("document", uri.toString()).toString())
    }

    private fun documents(): File =
        activity.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
            ?: error("native.provider.documents.unavailable")

    private fun fileLocation(file: File): JSObject {
        val root = documents().canonicalFile
        val target = file.canonicalFile
        check(target == root || target.path.startsWith(root.path + File.separator)) { "native.provider.documents.outside" }
        val relative = target.relativeTo(root).path
        return JSObject()
            .put("id", "android-documents:$relative")
            .put("name", if (relative.isEmpty()) "native.provider.documents.name" else target.name)
            .put(
                "display",
                if (relative.isEmpty()) {
                    "native.provider.documents.name"
                } else {
                    nativeText(
                        "native.provider.documents.path",
                        JSONObject().put("path", relative),
                    )
                },
            ).put("kind", "android-documents")
            .put("handle", if (relative.isEmpty()) "." else relative)
    }

    private fun isLink(file: File): Boolean =
        try {
            android.system.OsConstants.S_ISLNK(
                android.system.Os
                    .lstat(file.path)
                    .st_mode,
            )
        } catch (e: android.system.ErrnoException) {
            if (e.errno == android.system.OsConstants.ENOENT) false else throw e
        }

    private fun workspaceIdentity(location: AccessLocation?): String? {
        val loc = location ?: return null
        if (loc.kind == "android-documents") {
            val folder = File(documents().canonicalFile, loc.handle).canonicalFile
            fileLocation(folder)
            return WorkspaceIdentity.admit(folder)
        }
        if (loc.kind != "android-tree") return null
        val handle = JSONObject(loc.handle)
        val tree = Uri.parse(handle.getString("tree"))
        val root = Uri.parse(handle.getString("document"))
        if (resolver.persistedUriPermissions.none { it.uri == tree && it.isReadPermission }) return null
        val markers = children(tree, root).filter { it.name == ".situate" }
        val marker = markers.singleOrNull()?.takeIf { it.mime == Documents.Document.MIME_TYPE_DIR } ?: return null
        // SAF has no exclusive named-create operation for migrating an existing directory.
        return readWorkspaceIdentity(tree, marker.uri)
    }

    private fun readWorkspaceIdentity(
        tree: Uri,
        marker: Uri,
    ): String? {
        val documents = children(tree, marker).filter { it.name == "workspace.json" }
        val document =
            documents.singleOrNull()?.takeIf {
                it.mime != Documents.Document.MIME_TYPE_DIR && it.flags and Documents.Document.FLAG_VIRTUAL_DOCUMENT == 0
            } ?: return null
        return resolver.openInputStream(document.uri)?.use { stream ->
            val bytes = ByteArray(1025)
            var count = 0
            while (count < bytes.size) {
                val length = stream.read(bytes, count, bytes.size - count)
                if (length < 0) break
                if (length == 0) return null
                count += length
            }
            WorkspaceIdentity.validate(bytes.copyOf(count))
        }
    }

    private fun createWorkspaceIdentity(
        tree: Uri,
        marker: Uri,
    ) {
        check(children(tree, marker).isEmpty()) { "native.workspace.create.markerFailed" }
        val bytes = WorkspaceIdentity.bytes()
        val expected = WorkspaceIdentity.validate(bytes)
        val document =
            Documents.createDocument(resolver, marker, "application/json", "workspace.json")
                ?: error("native.workspace.create.markerFailed")
        val entries = children(tree, marker)
        check(entries.size == 1 && entries[0].uri == document && entries[0].name == "workspace.json") {
            "native.workspace.create.markerFailed"
        }
        resolver.openFileDescriptor(document, "rw")?.use { descriptor ->
            check(
                android.system.Os
                    .fstat(descriptor.fileDescriptor)
                    .st_size == 0L,
            ) { "native.workspace.create.markerFailed" }
            var count = 0
            while (count < bytes.size) {
                val length = android.system.Os.write(descriptor.fileDescriptor, bytes, count, bytes.size - count)
                check(length > 0) { "native.workspace.create.markerFailed" }
                count += length
            }
            android.system.Os.fsync(descriptor.fileDescriptor)
        } ?: error("native.workspace.create.markerFailed")
        check(readWorkspaceIdentity(tree, marker) == expected) { "native.workspace.create.markerFailed" }
    }

    private fun operate(args: AccessArgs): JSObject {
        val loc = args.location ?: error("native.workspace.folder.choose")
        if (args.operation != "inspect") {
            check(
                args.name.isNotBlank() && args.name != "." && args.name != ".." &&
                    !args.name.any { it == '/' || it == '\\' || it.code < 32 },
            ) { "native.provider.workspace.nameInvalid" }
        }
        if (loc.kind == "android-documents") {
            val root = documents().canonicalFile
            val parent = File(root, loc.handle).canonicalFile
            fileLocation(parent)
            check(parent.isDirectory && parent.canRead() && parent.canWrite()) { "native.provider.access.revoked" }
            if (args.operation == "inspect") {
                check(File(parent, ".situate").isDirectory) { "native.workspace.folder.notWorkspace" }
                check(File(parent, ".situate").list() != null) { "native.workspace.marker.readFailed" }
                return fileLocation(parent)
            }
            val child = File(parent, args.name)
            check(!child.exists() && !isLink(child)) { "native.workspace.folder.exists" }
            if (args.operation == "preflight") return fileLocation(parent)
            NewWorkspaceDirectory(parent, args.name).use { directory ->
                try {
                    directory.initialize()
                    val result = fileLocation(directory.path)
                    directory.requireCurrent()
                    return result
                } catch (e: Exception) {
                    error(directory.partial(e))
                }
            }
        }
        check(loc.kind == "android-tree") { "native.provider.handle.unsupported" }
        val handle = JSONObject(loc.handle)
        val tree = Uri.parse(handle.getString("tree"))
        val parent = Uri.parse(handle.getString("document"))
        check(
            resolver.persistedUriPermissions.any {
                it.uri == tree && it.isReadPermission && it.isWritePermission
            },
        ) { "native.provider.access.grantAgain" }
        requireDirectory(entry(parent))
        val existing = children(tree, parent)
        if (args.operation == "inspect") {
            val marker = existing.singleOrNull { it.name == ".situate" && it.mime == Documents.Document.MIME_TYPE_DIR }
            check(marker != null) { "native.workspace.folder.notWorkspace" }
            children(tree, marker.uri)
            return treeLocation(tree, parent, loc.display)
        }
        check(existing.none { it.name == args.name }) { "native.workspace.folder.exists" }
        if (args.operation == "preflight") return treeLocation(tree, parent, loc.display)
        val child =
            Documents.createDocument(resolver, parent, Documents.Document.MIME_TYPE_DIR, args.name)
                ?: error("native.provider.create.failed")
        try {
            val actual = entry(child)
            val remaining =
                if (loc.display.startsWith("native.") || loc.display.startsWith("{")) {
                    nativeText("native.workspace.location.child", JSONObject().put("parent", loc.display).put("name", actual.name))
                } else {
                    "${loc.display}/${actual.name}"
                }
            // SAF can rename a colliding request; never accept that as the requested creation.
            check(
                actual.name == args.name && existing.none { it.uri == child } &&
                    children(tree, parent).count { it.name == args.name } == 1,
            ) {
                "native.provider.create.nameMismatch"
            }
            check(children(tree, child).isEmpty()) { "native.provider.create.notEmpty" }
            val marker =
                Documents.createDocument(resolver, child, Documents.Document.MIME_TYPE_DIR, ".situate")
                    ?: error("native.provider.create.markerFailed")
            check(entry(marker).name == ".situate") { "native.provider.create.markerUnsupported" }
            createWorkspaceIdentity(tree, marker)
            return treeLocation(tree, child, remaining)
        } catch (e: Exception) {
            error(nativeError("native.provider.create.partial", child.toString(), e))
        }
    }
}

@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package dev.situate.access

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.test.InstrumentationTestCase
import android.test.mock.MockContentProvider
import android.test.mock.MockContentResolver
import android.widget.FrameLayout
import androidx.activity.result.ActivityResult
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import android.provider.DocumentsContract as Documents

class WorkspaceAccessTest : InstrumentationTestCase() {
    private lateinit var root: File

    override fun setUp() {
        root = File(instrumentation.targetContext.cacheDir, "workspace-access-${System.nanoTime()}")
        check(root.mkdir())
    }

    override fun tearDown() {
        root.deleteRecursively()
    }

    fun testSharedContentPathContract() {
        val cases =
            instrumentation.context.assets
                .open("content-paths.json")
                .use { ObjectMapper().readTree(it) }
        assertTrue(cases.size() > 0)
        for (test in cases) {
            val path = test["path"].asText()
            for ((policy, key) in listOf(
                ContentPathPolicy.ProviderReadable to "provider",
                ContentPathPolicy.PortableWritable to "portable",
            )) {
                val result = runCatching { contentComponents(path, policy = policy) }
                assertEquals("Path policy mismatch: $path", test[key].asBoolean(), result.isSuccess)
                if (result.isSuccess) assertEquals(path, result.getOrThrow().joinToString("/"))
            }
        }
        assertEquals(emptyList<String>(), contentComponents("", allowRoot = true))
    }

    fun testContentInsetsConsumeSystemEdgesAndTrackKeyboard() {
        instrumentation.runOnMainSync {
            val content = FrameLayout(instrumentation.targetContext)
            fitWebContentToInsets(content)

            fun dispatch(keyboard: Int): WindowInsetsCompat {
                val insets =
                    WindowInsetsCompat
                        .Builder()
                        .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 32))
                        .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.of(12, 40, 0, 0))
                        .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, keyboard))
                        .build()
                return ViewCompat.dispatchApplyWindowInsets(content, insets)
            }
            assertTrue(dispatch(0).isConsumed)
            assertEquals(12, content.paddingLeft)
            assertEquals(40, content.paddingTop)
            assertEquals(0, content.paddingRight)
            assertEquals(32, content.paddingBottom)
            assertTrue(dispatch(300).isConsumed)
            assertEquals(300, content.paddingBottom)
            dispatch(0)
            assertEquals(32, content.paddingBottom)
        }
    }

    fun testCreationAndCollisionPreserveExistingData() {
        NewWorkspaceDirectory(root, "Garden").use {
            it.initialize()
            it.requireCurrent()
        }
        assertEquals(listOf(".situate"), File(root, "Garden").list()!!.toList())
        assertEquals(listOf("workspace.json"), File(root, "Garden/.situate").list()!!.toList())
        File(root, "Garden/keep").writeText("unchanged")
        expectFailure { NewWorkspaceDirectory(root, "Garden").close() }
        assertEquals("unchanged", File(root, "Garden/keep").readText())
    }

    fun testPortableIdentityCreationCopyAndCorruption() {
        NewWorkspaceDirectory(root, "First").use { it.initialize() }
        NewWorkspaceDirectory(root, "Second").use { it.initialize() }
        val first = File(root, "First")
        val id = WorkspaceIdentity.admit(first)
        assertNotNull(id)
        assertEquals(id, WorkspaceIdentity.admit(first))
        assertFalse(id == WorkspaceIdentity.admit(File(root, "Second")))
        val copy = File(root, "Copy")
        check(first.copyRecursively(copy))
        assertEquals(id, WorkspaceIdentity.admit(copy))
        val metadata = File(copy, ".situate/workspace.json")
        metadata.writeText("private sentinel")
        assertNull(WorkspaceIdentity.admit(copy))
        assertEquals("private sentinel", metadata.readText())
        metadata.delete()
        Os.symlink(File(root, "outside").path, metadata.path)
        assertNull(WorkspaceIdentity.admit(copy))
        assertFalse(File(root, "outside").exists())
    }

    fun testConcurrentLegacyIdentityAdmissionsConverge() {
        check(File(root, ".situate").mkdir())
        val barrier = java.util.concurrent.CyclicBarrier(8)
        val executor =
            java.util.concurrent.Executors
                .newFixedThreadPool(8)
        try {
            val tasks =
                (0 until 8).map {
                    executor.submit<String?> {
                        barrier.await()
                        WorkspaceIdentity.admit(root)
                    }
                }
            val identities = tasks.map { it.get(10, TimeUnit.SECONDS) }
            assertNotNull(identities[0])
            assertTrue(identities.all { it == identities[0] })
            assertEquals(listOf("workspace.json"), File(root, ".situate").list()!!.toList())
        } finally {
            executor.shutdownNow()
        }
    }

    fun testNativePublicationConsumesStageAndUsesHeldDirectory() {
        val marker = File(root, "marker").apply { check(mkdir()) }
        val moved = File(root, "moved")
        val bytes = "{\"version\":1,\"id\":\"1d44dd21-3194-42cc-bb00-a2a8e77456ca\"}\n".toByteArray()
        File(marker, "stage").writeBytes(bytes)
        DirectoryHandle(marker).use { directory ->
            check(marker.renameTo(moved))
            check(marker.mkdir())
            directory.publishNoReplace("stage", "workspace.json")
            directory.sync()
        }
        assertTrue(bytes.contentEquals(File(moved, "workspace.json").readBytes()))
        assertFalse(File(moved, "stage").exists())
        assertTrue(marker.list()!!.isEmpty())
    }

    fun testNativePublicationNeverClobbersExistingMetadata() {
        val valid = "{\"version\":1,\"id\":\"1d44dd21-3194-42cc-bb00-a2a8e77456ca\"}"
        val outside = File(root, "outside").apply { writeText("outside sentinel") }
        for (kind in listOf("valid", "corrupt", "symlink", "dangling", "directory")) {
            val marker = File(root, kind).apply { check(mkdir()) }
            val target = File(marker, "workspace.json")
            when (kind) {
                "valid" -> target.writeText(valid)
                "corrupt" -> target.writeText("corrupt sentinel")
                "symlink" -> Os.symlink(outside.path, target.path)
                "dangling" -> Os.symlink(File(root, "missing").path, target.path)
                else -> check(target.mkdir())
            }
            val identity = Os.lstat(target.path)
            val stage = File(marker, "stage").apply { writeText("new metadata") }
            DirectoryHandle(marker).use { directory ->
                expectErrno(OsConstants.EEXIST) { directory.publishNoReplace("stage", "workspace.json") }
            }
            val preserved = Os.lstat(target.path)
            assertEquals(identity.st_ino, preserved.st_ino)
            assertEquals(identity.st_mode, preserved.st_mode)
            assertEquals("new metadata", stage.readText())
            when (kind) {
                "valid" -> assertEquals(valid, target.readText())
                "corrupt" -> assertEquals("corrupt sentinel", target.readText())
                "symlink" -> assertEquals(outside.path, Os.readlink(target.path))
                "dangling" -> assertEquals(File(root, "missing").path, Os.readlink(target.path))
                else -> assertTrue(target.list()!!.isEmpty())
            }
        }
        assertEquals("outside sentinel", outside.readText())
        assertFalse(File(root, "missing").exists())
    }

    fun testNativePublicationRejectsInvalidInputsWithoutMovingStage() {
        val stage = File(root, "stage").apply { writeText("staged sentinel") }
        ParcelFileDescriptor.open(root, ParcelFileDescriptor.MODE_READ_ONLY).use { directory ->
            val invalid = listOf(null, "", ".", "..", "../stage", "/stage", "a/b", "a\u0000b", "é", "x".repeat(256))
            for (name in invalid) {
                expectErrno(OsConstants.EINVAL) { WorkspacePublication.publish(directory.fd, name, "target") }
                expectErrno(OsConstants.EINVAL) { WorkspacePublication.publish(directory.fd, "stage", name) }
            }
            expectErrno(OsConstants.EINVAL) { WorkspacePublication.publish(directory.fd, "stage", "stage") }
            expectErrno(OsConstants.EBADF) { WorkspacePublication.publish(-1, "stage", "target") }
            expectErrno(OsConstants.ENOENT) { WorkspacePublication.publish(directory.fd, "absent", "target") }
            Os.symlink(stage.path, File(root, "link").path)
            expectErrno(OsConstants.EINVAL) { WorkspacePublication.publish(directory.fd, "link", "target") }
            check(File(root, "directory").mkdir())
            expectErrno(OsConstants.EINVAL) { WorkspacePublication.publish(directory.fd, "directory", "target") }
        }
        ParcelFileDescriptor.open(stage, ParcelFileDescriptor.MODE_READ_ONLY).use { file ->
            expectErrno(OsConstants.ENOTDIR) { WorkspacePublication.publish(file.fd, "stage", "target") }
        }
        assertEquals("staged sentinel", stage.readText())
        assertFalse(File(root, "target").exists())
    }

    fun testExistingMetadataAdmissionPreservesBytesAndSymlinks() {
        val marker = File(root, ".situate").apply { check(mkdir()) }
        val metadata = File(marker, "workspace.json")
        val id = "1d44dd21-3194-42cc-bb00-a2a8e77456ca"
        for ((text, expected) in listOf("{ \"id\":\"$id\", \"version\":1 }\n" to id, "corrupt sentinel" to null)) {
            metadata.writeText(text)
            val identity = Os.lstat(metadata.path)
            assertEquals(expected, WorkspaceIdentity.admit(root))
            assertEquals(text, metadata.readText())
            assertEquals(identity.st_ino, Os.lstat(metadata.path).st_ino)
            assertEquals(listOf("workspace.json"), marker.list()!!.toList())
        }
        check(metadata.delete())
        val outside = File(root, "outside").apply { writeText("outside sentinel") }
        Os.symlink(outside.path, metadata.path)
        assertNull(WorkspaceIdentity.admit(root))
        assertEquals(outside.path, Os.readlink(metadata.path))
        assertEquals("outside sentinel", outside.readText())
        assertEquals(listOf("workspace.json"), marker.list()!!.toList())
    }

    fun testNativePublicationFailsClosedInReadOnlyDirectory() {
        val marker = File(root, "marker").apply { check(mkdir()) }
        val stage = File(marker, "stage").apply { writeText("staged sentinel") }
        DirectoryHandle(marker).use { directory ->
            Os.chmod(marker.path, 0x140)
            try {
                expectErrno(OsConstants.EACCES) { directory.publishNoReplace("stage", "workspace.json") }
                assertEquals("staged sentinel", stage.readText())
                assertFalse(File(marker, "workspace.json").exists())
            } finally {
                Os.chmod(marker.path, 0x1c0)
            }
        }
    }

    fun testIdentityPublicationInApplicationDocuments() {
        val documents = instrumentation.targetContext.getExternalFilesDir(android.os.Environment.DIRECTORY_DOCUMENTS)!!
        val parent = File(documents, "publication-${System.nanoTime()}").apply { check(mkdir()) }
        try {
            NewWorkspaceDirectory(parent, "Workspace").use { directory ->
                directory.initialize()
                val metadata = File(directory.path, ".situate/workspace.json")
                val bytes = metadata.readBytes()
                val id = WorkspaceIdentity.validate(bytes)
                assertNotNull(id)
                assertEquals(id, WorkspaceIdentity.admit(directory.path))
                assertTrue(bytes.contentEquals(metadata.readBytes()))
                assertEquals(listOf("workspace.json"), metadata.parentFile!!.list()!!.toList())
            }
        } finally {
            check(parent.deleteRecursively())
        }
    }

    private fun expectErrno(
        expected: Int,
        operation: () -> Unit,
    ) {
        try {
            operation()
            fail("Expected errno $expected")
        } catch (error: ErrnoException) {
            assertEquals(expected, error.errno)
        }
    }

    fun testIdentityValidationRejectsPrivateAndUnversionedMetadata() {
        val id = "1d44dd21-3194-42cc-bb00-a2a8e77456ca"
        assertEquals(id, WorkspaceIdentity.validate("{\"version\":1,\"id\":\"$id\"}".toByteArray()))
        for (text in listOf(
            "private sentinel",
            " ".repeat(1025),
            "{\"version\":2,\"id\":\"$id\"}",
            "{\"version\":1,\"id\":\"$id\",\"device\":\"private sentinel\"}",
        )) {
            assertNull(WorkspaceIdentity.validate(text.toByteArray()))
        }
    }

    fun testReplacedChildIsNeverInitialized() {
        for (populated in listOf(false, true)) {
            val name = "Garden-$populated"
            NewWorkspaceDirectory(root, name).use { directory ->
                val moved = File(root, "$name-moved")
                check(directory.path.renameTo(moved))
                check(directory.path.mkdir())
                if (populated) File(directory.path, "keep").writeText("unchanged")
                expectFailure { directory.initialize() }
                assertFalse(File(directory.path, ".situate").exists())
                assertFalse(File(moved, ".situate").exists())
                if (populated) assertEquals("unchanged", File(directory.path, "keep").readText())
            }
        }
    }

    fun testSymlinksAndNonemptyAcquiredDirectoriesAreRejected() {
        val existing = File(root, "existing").apply { mkdir() }
        val link = File(root, "link")
        Os.symlink(existing.path, link.path)
        expectFailure { DirectoryHandle(link).close() }
        NewWorkspaceDirectory(root, "Garden").use { directory ->
            File(directory.path, "keep").writeText("unchanged")
            expectFailure { directory.initialize() }
            assertFalse(File(directory.path, ".situate").exists())
        }
        assertFalse(File(existing, ".situate").exists())
    }

    fun testParentAndLateChildReplacementAreDetected() {
        val parent = File(root, "parent").apply { mkdir() }
        NewWorkspaceDirectory(parent, "Garden").use { directory ->
            val moved = File(root, "moved")
            check(parent.renameTo(moved))
            check(parent.mkdir())
            expectFailure { directory.initialize() }
            assertFalse(File(moved, "Garden/.situate").exists())
            check(parent.delete())
            check(moved.renameTo(parent))
            directory.initialize()
            check(directory.path.renameTo(File(parent, "moved-child")))
            check(directory.path.mkdir())
            expectFailure { directory.requireCurrent() }
            assertFalse(File(directory.path, ".situate").exists())
        }
    }

    fun testDefaultAccessIsSerializedOffMainAndCancellationStaysResponsive() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        var storageThread: Thread? = null
        lateinit var plugin: WorkspaceAccessPlugin
        instrumentation.runOnMainSync {
            plugin =
                WorkspaceAccessPlugin(
                    object : TestActivity(instrumentation.targetContext) {
                        override fun getExternalFilesDir(type: String?): File {
                            calls.incrementAndGet()
                            storageThread = Thread.currentThread()
                            entered.countDown()
                            check(release.await(5, TimeUnit.SECONDS))
                            return root
                        }
                    },
                )
        }
        val first = Reply("""{"operation":"default"}""")
        val second = Reply("""{"operation":"default"}""")
        val cancelled = Reply("{}")
        try {
            instrumentation.runOnMainSync { plugin.access(first.invoke) }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                plugin.access(second.invoke)
                plugin.picked(cancelled.invoke, ActivityResult(Activity.RESULT_CANCELED, null))
            }
            cancelled.requireSuccess()
            assertNotSame(Looper.getMainLooper().thread, storageThread)
            assertEquals(1, calls.get())
            assertEquals(1L, second.done.count)
        } finally {
            release.countDown()
        }
        first.requireSuccess()
        second.requireSuccess()
    }

    fun testInspectPreflightAndCreateRunOffMain() {
        check(File(root, ".situate").mkdir())
        val storageCalls = AtomicInteger()
        lateinit var plugin: WorkspaceAccessPlugin
        instrumentation.runOnMainSync {
            plugin =
                WorkspaceAccessPlugin(
                    object : TestActivity(instrumentation.targetContext) {
                        override fun getExternalFilesDir(type: String?): File {
                            check(Thread.currentThread() != Looper.getMainLooper().thread)
                            storageCalls.incrementAndGet()
                            return root
                        }
                    },
                )
        }
        for (operation in listOf("inspect", "preflight", "create")) {
            val reply = Reply("""{"operation":"$operation","name":"Child","location":{"kind":"android-documents","handle":"."}}""")
            instrumentation.runOnMainSync { plugin.access(reply.invoke) }
            reply.requireSuccess()
        }
        assertTrue(storageCalls.get() >= 3)
        assertTrue(File(root, "Child/.situate").isDirectory)
    }

    fun testPickedProviderQueriesRunOffMain() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        var queryThread: Thread? = null
        var grantThread: Thread? = null
        val resolver =
            object : MockContentResolver(instrumentation.targetContext) {
                override fun takePersistableUriPermission(
                    uri: Uri,
                    flags: Int,
                ) {
                    grantThread = Thread.currentThread()
                }
            }
        resolver.addProvider(
            "workspace-test",
            object : MockContentProvider() {
                override fun query(
                    uri: Uri,
                    projection: Array<out String>?,
                    selection: String?,
                    selectionArgs: Array<out String>?,
                    sortOrder: String?,
                ): MatrixCursor {
                    queryThread = Thread.currentThread()
                    entered.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    return MatrixCursor(projection!!).apply {
                        if (!uri.path!!.endsWith(
                                "/children",
                            )
                        ) {
                            addRow(
                                arrayOf<Any>("Garden", Documents.Document.MIME_TYPE_DIR, Documents.Document.FLAG_DIR_SUPPORTS_CREATE),
                            )
                        }
                    }
                }
            },
        )
        lateinit var plugin: WorkspaceAccessPlugin
        instrumentation.runOnMainSync {
            plugin =
                WorkspaceAccessPlugin(
                    object : TestActivity(instrumentation.targetContext) {
                        override fun getContentResolver(): ContentResolver = resolver
                    },
                )
        }
        val reply = Reply("{}")
        val tree = Documents.buildTreeDocumentUri("workspace-test", "garden")
        val data = Intent().setData(tree).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        try {
            instrumentation.runOnMainSync { plugin.picked(reply.invoke, ActivityResult(Activity.RESULT_OK, data)) }
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val mainResponsive = CountDownLatch(1)
            instrumentation.runOnMainSync { mainResponsive.countDown() }
            assertEquals(0L, mainResponsive.count)
            assertNotSame(Looper.getMainLooper().thread, queryThread)
            assertSame(queryThread, grantThread)
        } finally {
            release.countDown()
        }
        reply.requireSuccess()
    }

    fun testProviderContentUsesOpaqueIdsAndBoundsUnknownSizeReads() {
        val provider = ContentProviderFixture(root)
        val content = provider.content(instrumentation.targetContext)
        assertEquals(listOf(ContentEntry("Notes", true)), content.list())
        assertEquals(listOf(ContentEntry("note.md", false)), content.list("Notes"))
        val snapshot = content.read("Notes/note.md", 4)
        assertTrue(byteArrayOf(0, -1, 65, 10).contentEquals(snapshot.bytes))
        assertEquals("opaque:file/with/slashes", Documents.getDocumentId(snapshot.document))
        expectFailure { content.read("Notes/note.md", 3) }
        expectFailure { content.read("Notes/note.md", 0) }
        expectFailure { content.read("Notes/note.md", 16 * 1024 * 1024 + 1) }
        provider.file.writeBytes(byteArrayOf())
        assertTrue(content.read("Notes/note.md", 1).bytes.isEmpty())
        assertEquals(0, provider.outputOpens)
    }

    fun testProviderContentPreservesExistingNonportableNames() {
        val provider = ContentProviderFixture(root)
        val content = provider.content(instrumentation.targetContext)
        for (name in listOf("existing.", "existing ", "line\nname", "Unicode-\u03bb-\u00e9-\ud83c\udf31.md")) {
            provider.fileName = name
            assertEquals(listOf(ContentEntry(name, false)), content.list("Notes"))
            assertTrue(provider.file.readBytes().contentEquals(content.read("Notes/$name", 100).bytes))
        }
    }

    fun testProviderLocalizationReadsMissingAndStoredSettingsWithoutWrites() {
        val provider = ContentProviderFixture(root)
        val content = provider.content(instrumentation.targetContext)
        assertNull(content.localization())
        assertEquals(0, provider.inputOpens)
        assertFalse(provider.settings.exists())
        val preferences = """{"version":1,"language":"de","custom":"preserved"}""".toByteArray()
        provider.settings.writeBytes(preferences)
        assertTrue(preferences.contentEquals(content.localization()!!))
        assertTrue(preferences.contentEquals(provider.settings.readBytes()))
        expectFailure { content.read(".situate/localization.json", 65_536) }
        provider.settings.writeBytes(ByteArray(65_537))
        expectFailure { content.localization() }
        provider.duplicate = true
        expectFailure { content.localization() }
        assertEquals(0, provider.outputOpens)
    }

    fun testProviderAppearanceReadsMissingAndStoredSettingsWithoutWrites() {
        val provider = ContentProviderFixture(root).apply { settingsName = "appearance.json" }
        val content = provider.content(instrumentation.targetContext)
        assertNull(content.appearance())
        assertEquals(0, provider.inputOpens)
        assertFalse(provider.settings.exists())
        val accents = """{"version":1,"accent":"sky","custom":"preserved"}""".toByteArray()
        provider.settings.writeBytes(accents)
        assertTrue(accents.contentEquals(content.appearance()!!))
        assertTrue(accents.contentEquals(provider.settings.readBytes()))
        expectFailure { content.read(".situate/appearance.json", 65_536) }
        provider.settings.writeBytes(ByteArray(65_537))
        expectFailure { content.appearance() }
        provider.duplicate = true
        expectFailure { content.appearance() }
        assertEquals(0, provider.outputOpens)
    }

    fun testProviderContentRejectsTraversalInternalsAmbiguityAndIncompleteListings() {
        val provider = ContentProviderFixture(root)
        val content = provider.content(instrumentation.targetContext)
        for (path in listOf(
            "",
            "/Notes/note.md",
            "../note.md",
            "Notes//note.md",
            "Notes/../note.md",
            "Notes/",
            "Notes\\\\note.md",
            "Notes\u0000x",
            ".git/config",
            ".SiTuAtE/state",
            "Notes/.GIT/config",
            ".situate-write-pending",
        )) {
            expectFailure { content.read(path, 100) }
        }
        assertEquals(0, provider.inputOpens)
        provider.duplicate = true
        expectFailure { content.list("Notes") }
        expectFailure { content.read("Notes/note.md", 100) }
        provider.duplicate = false
        provider.loading = true
        expectFailure { content.list() }
        provider.loading = false
        provider.queryError = true
        expectFailure { content.list() }
        provider.queryError = false
        provider.virtual = true
        expectFailure { content.read("Notes/note.md", 100) }
        provider.virtual = false
        provider.unreadable = true
        expectFailure { content.read("Notes/note.md", 100) }
        assertEquals(0, provider.outputOpens)
    }

    fun testProviderReplacementRefusesWithoutTruncatingOriginalOrConsumingDraft() {
        val provider = ContentProviderFixture(root)
        val content = provider.content(instrumentation.targetContext)
        val snapshot = content.read("Notes/note.md", 4)
        val draft = "pending draft".toByteArray()
        assertEquals("unsupported-no-conditional-atomic-replacement", content.replacementCapability)
        expectFailure { content.replace("Notes/note.md", snapshot, draft) }
        assertTrue(snapshot.bytes.contentEquals(provider.file.readBytes()))
        provider.file.writeText("external edit")
        expectFailure { content.replace("Notes/note.md", snapshot, draft) }
        assertEquals("external edit", provider.file.readText())
        provider.file.delete()
        expectFailure { content.replace("Notes/note.md", snapshot, draft) }
        assertFalse(provider.file.exists())
        assertTrue(byteArrayOf(0, -1, 65, 10).contentEquals(snapshot.bytes))
        assertEquals("pending draft", String(draft))
        assertEquals(0, provider.outputOpens)
        expectFailure { WorkspaceContent(provider.resolver, Uri.parse("file:///not-a-tree"), provider.rootUri) }
    }

    private class ContentProviderFixture(
        root: File,
    ) : MockContentProvider() {
        val file = File(root, "provider-bytes").apply { writeBytes(byteArrayOf(0, -1, 65, 10)) }
        val settings = File(root, "provider-settings")
        private val tree = Documents.buildTreeDocumentUri("content-fixture", "opaque:root")
        val rootUri = Documents.buildDocumentUriUsingTree(tree, "opaque:root")
        lateinit var resolver: MockContentResolver
        var duplicate = false
        var loading = false
        var queryError = false
        var virtual = false
        var unreadable = false
        var fileName = "note.md"
        var settingsName = "localization.json"
        var inputOpens = 0
        var outputOpens = 0

        fun content(context: Context): WorkspaceContent {
            resolver = MockContentResolver(context)
            resolver.addProvider("content-fixture", this)
            return WorkspaceContent(resolver, tree, rootUri)
        }

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): MatrixCursor {
            // COLUMN_SIZE is deliberately absent: unknown provider sizes must not bypass the stream limit.
            check(!projection!!.contains(Documents.Document.COLUMN_SIZE))
            return MatrixCursor(projection).apply {
                extras =
                    android.os.Bundle().apply {
                        putBoolean(Documents.EXTRA_LOADING, loading)
                        if (queryError) putString(Documents.EXTRA_ERROR, "Synthetic provider failure")
                    }

                fun row(
                    id: String,
                    name: String,
                    directory: Boolean,
                ) {
                    addRow(
                        arrayOf<Any>(
                            id,
                            name,
                            if (directory) Documents.Document.MIME_TYPE_DIR else "text/markdown",
                            if (virtual && !directory) Documents.Document.FLAG_VIRTUAL_DOCUMENT else 0,
                        ),
                    )
                }
                if (uri == rootUri) {
                    row("opaque:root", "Workspace", true)
                } else if (Documents.getDocumentId(uri) == "opaque:root") {
                    row("opaque:notes", "Notes", true)
                    row("opaque:git", ".git", true)
                    row("opaque:state", ".situate", true)
                    row("opaque:pending", ".situate-write-pending", false)
                    row("opaque:invalid", "../escape", false)
                } else if (Documents.getDocumentId(uri) == "opaque:state") {
                    if (settings.exists()) row("opaque:settings", settingsName, false)
                    if (duplicate) row("opaque:duplicate-settings", settingsName, false)
                } else {
                    row("opaque:file/with/slashes", fileName, false)
                    if (duplicate) row("opaque:other", fileName, false)
                }
            }
        }

        override fun openTypedAssetFile(
            uri: Uri,
            mimeTypeFilter: String,
            opts: android.os.Bundle?,
        ): android.content.res.AssetFileDescriptor = openAssetFile(uri, "r")

        override fun openAssetFile(
            uri: Uri,
            mode: String,
        ): android.content.res.AssetFileDescriptor =
            android.content.res.AssetFileDescriptor(openFile(uri, mode), 0, android.content.res.AssetFileDescriptor.UNKNOWN_LENGTH)

        override fun openFile(
            uri: Uri,
            mode: String,
        ): android.os.ParcelFileDescriptor {
            if (mode == "r") inputOpens++ else outputOpens++
            check(mode == "r") { "A content read opened a writable stream." }
            if (unreadable) throw java.io.FileNotFoundException("Synthetic unavailable content")
            val source =
                when (Documents.getDocumentId(uri)) {
                    "opaque:file/with/slashes" -> file
                    "opaque:settings" -> settings
                    else -> error("Unexpected document ID")
                }
            return android.os.ParcelFileDescriptor.open(source, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
        }
    }

    private fun expectFailure(operation: () -> Unit) {
        var failed = false
        try {
            operation()
        } catch (_: Exception) {
            failed = true
        }
        assertTrue("Operation must reject the changed or occupied directory", failed)
    }

    private open class TestActivity(
        context: Context,
    ) : Activity() {
        init {
            attachBaseContext(context)
        }
    }

    private class Reply(
        args: String,
    ) {
        val done = CountDownLatch(1)
        private var error: String? = null
        val invoke =
            Invoke(1, "access", 0, 1, { callback, data ->
                if (callback != 0L) error = data
                done.countDown()
            }, args, ObjectMapper())

        fun requireSuccess() {
            assertTrue("Native response did not arrive", done.await(5, TimeUnit.SECONDS))
            assertNull(error)
        }
    }
}

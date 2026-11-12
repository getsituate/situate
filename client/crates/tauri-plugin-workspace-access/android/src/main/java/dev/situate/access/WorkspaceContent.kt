package dev.situate.access

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract as Documents

internal enum class ContentPathPolicy { ProviderReadable, PortableWritable }

internal fun contentComponents(
    path: String,
    allowRoot: Boolean = false,
    policy: ContentPathPolicy = ContentPathPolicy.ProviderReadable,
): List<String> {
    if (allowRoot && path.isEmpty()) return emptyList()
    val parts = path.split('/')
    require(
        parts.all { part ->
            val alias = part.trimEnd(' ', '.').lowercase(java.util.Locale.ROOT)
            val safe =
                alias.isNotEmpty() && !part.contains('\\') && !part.contains(':') && !part.contains('\u0000') &&
                    !alias.startsWith(".situate-write-") && alias != ".git" && alias != ".situate"
            val portable =
                part.none { it.code <= 31 || it.code in 127..159 } &&
                    !part.endsWith(' ') && !part.endsWith('.')
            safe && (policy == ContentPathPolicy.ProviderReadable || portable)
        },
    ) {
        "native.provider.path.unsafe"
    }
    return parts
}

internal data class ContentEntry(
    val name: String,
    val directory: Boolean,
)

/** An observed read, not a persistent file identity or a conditional-write token. */
internal data class ProviderSnapshot(
    val document: Uri,
    val bytes: ByteArray,
)

/** Native-only SAF boundary. Tree grants remain owned by the workspace lifecycle.
 * Document IDs are opaque; names are resolved by querying each parent, never Uri.path.
 * Reads are observations, not atomic snapshots against an uncooperative provider.
 */
internal class WorkspaceContent(
    private val resolver: ContentResolver,
    private val tree: Uri,
    private val root: Uri,
) {
    init {
        require(
            tree.scheme == "content" && root.scheme == "content" &&
                tree.authority == root.authority && Documents.isTreeUri(tree) &&
                Documents.isTreeUri(root) && Documents.getTreeDocumentId(tree) == Documents.getTreeDocumentId(root),
        ) {
            "native.provider.tree.required"
        }
    }

    val replacementCapability = "unsupported-no-conditional-atomic-replacement"

    fun list(path: String = ""): List<ContentEntry> {
        val directory = resolve(contentComponents(path, allowRoot = true))
        requireDirectory(directory)
        val entries = children(directory.uri)
        check(entries.map { it.name }.distinct().size == entries.size) { "native.provider.names.ambiguous" }
        return entries
            .filter { runCatching { contentComponents(it.name) }.isSuccess && !it.name.contains('/') }
            .map { ContentEntry(it.name, it.directory) }
            .sortedBy { it.name }
    }

    fun read(
        path: String,
        maxBytes: Int,
    ): ProviderSnapshot {
        require(maxBytes in 1..16 * 1024 * 1024) { "native.provider.read.limitInvalid" }
        return readParts(contentComponents(path), maxBytes)
    }

    fun localization(): ByteArray? {
        val directory = resolve(listOf(".situate"))
        requireDirectory(directory)
        val matches = children(directory.uri).filter { it.name == "localization.json" }
        check(matches.size <= 1) { "native.localization.invalid" }
        if (matches.isEmpty()) return null
        return readParts(listOf(".situate", "localization.json"), 65_536).bytes
    }

    fun appearance(): ByteArray? {
        val directory = resolve(listOf(".situate"))
        requireDirectory(directory)
        val matches = children(directory.uri).filter { it.name == "appearance.json" }
        check(matches.size <= 1) { "native.appearance.invalid" }
        if (matches.isEmpty()) return null
        return readParts(listOf(".situate", "appearance.json"), 65_536).bytes
    }

    private fun readParts(
        parts: List<String>,
        maxBytes: Int,
    ): ProviderSnapshot {
        val file = resolve(parts)
        check(!file.directory && file.flags and Documents.Document.FLAG_VIRTUAL_DOCUMENT == 0) {
            "native.provider.read.regularOnly"
        }
        val bytes =
            resolver.openInputStream(file.uri)?.use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer, 0, minOf(buffer.size, maxBytes - output.size() + 1))
                    if (count < 0) break
                    check(count > 0) { "native.provider.read.noProgress" }
                    check(output.size() + count <= maxBytes) { "native.provider.read.tooLarge" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: error("native.provider.read.openFailed")
        check(resolve(parts).uri == file.uri) { "native.provider.read.locationChanged" }
        return ProviderSnapshot(file.uri, bytes)
    }

    /** Never opens a truncating stream: SAF write/rename flags do not promise CAS,
     * atomic replacement or rollback. The caller keeps its base and recovery draft.
     */
    fun replace(
        path: String,
        expected: ProviderSnapshot,
        draft: ByteArray,
    ): Nothing {
        contentComponents(path)
        throw UnsupportedOperationException("native.provider.write.unsupported")
    }

    private data class Document(
        val uri: Uri,
        val name: String,
        val mime: String,
        val flags: Int,
    ) {
        val directory get() = mime == Documents.Document.MIME_TYPE_DIR
    }

    private val columns =
        arrayOf(
            Documents.Document.COLUMN_DOCUMENT_ID,
            Documents.Document.COLUMN_DISPLAY_NAME,
            Documents.Document.COLUMN_MIME_TYPE,
            Documents.Document.COLUMN_FLAGS,
        )

    private fun query(uri: Uri): List<Document> {
        val result = mutableListOf<Document>()
        val cursor = resolver.query(uri, columns, null, null, null) ?: error("native.provider.unavailable")
        cursor.use {
            check(
                !it.extras.getBoolean(Documents.EXTRA_LOADING, false) &&
                    it.extras.getString(Documents.EXTRA_ERROR) == null,
            ) { "native.provider.list.incomplete" }
            while (it.moveToNext()) {
                check((0..3).none { index -> it.isNull(index) }) { "native.provider.metadata.incomplete" }
                result.add(
                    Document(
                        Documents.buildDocumentUriUsingTree(tree, it.getString(0)),
                        it.getString(1),
                        it.getString(2),
                        it.getInt(3),
                    ),
                )
            }
        }
        return result
    }

    private fun children(parent: Uri) = query(Documents.buildChildDocumentsUriUsingTree(tree, Documents.getDocumentId(parent)))

    private fun requireDirectory(document: Document) {
        check(
            document.directory && document.flags and Documents.Document.FLAG_VIRTUAL_DOCUMENT == 0,
        ) { "native.provider.folder.unavailable" }
    }

    private fun resolve(parts: List<String>): Document {
        var current = query(root).singleOrNull() ?: error("native.files.workspace.folderUnavailable")
        for (part in parts) {
            requireDirectory(current)
            current = children(current.uri).singleOrNull { it.name == part }
                ?: error("native.provider.path.ambiguous")
        }
        return current
    }
}

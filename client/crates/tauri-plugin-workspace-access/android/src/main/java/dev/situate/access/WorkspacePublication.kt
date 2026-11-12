package dev.situate.access

import android.system.ErrnoException
import java.io.IOException

internal object WorkspacePublication {
    private val library = runCatching { System.loadLibrary("workspace_publication") }

    fun publish(
        directoryFd: Int,
        source: String?,
        target: String?,
    ) {
        library.getOrElse { throw IOException("Native publication unavailable", it) }
        val error =
            try {
                renameNoReplace(directoryFd, source, target)
            } catch (error: LinkageError) {
                throw IOException("Native publication unavailable", error)
            }
        if (error != 0) throw ErrnoException("renameat2", error)
    }

    private external fun renameNoReplace(
        directoryFd: Int,
        source: String?,
        target: String?,
    ): Int
}

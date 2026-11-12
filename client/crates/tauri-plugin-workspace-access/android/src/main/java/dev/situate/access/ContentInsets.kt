package dev.situate.access

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

internal fun fitWebContentToInsets(content: View) {
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
        val edges =
            insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
        // Edge-to-edge WebView does not reliably expose gesture/IME bounds to CSS.
        // Inset its native container and consume them so CSS cannot apply them twice.
        view.setPadding(edges.left, edges.top, edges.right, edges.bottom)
        WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
}

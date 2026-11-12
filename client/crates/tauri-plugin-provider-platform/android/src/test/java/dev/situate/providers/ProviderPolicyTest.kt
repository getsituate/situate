package dev.situate.providers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderPolicyTest {
    @Test fun onlyFixedProviderBrowserRoutes() {
        assertTrue(ProviderPolicy.browser("https://auth.openai.com/codex/device"))
        assertTrue(ProviderPolicy.browser("https://openrouter.ai/auth?code_challenge=synthetic"))
        for (url in listOf(
            "http://auth.openai.com/codex/device",
            "https://auth.openai.com.evil.invalid/codex/device",
            "https://user@auth.openai.com/codex/device",
            "https://auth.openai.com:444/codex/device",
            "https://auth.openai.com/codex/device#token",
            "https://auth.openai.com/logout",
            "file:///tmp/secret",
        )) {
            assertFalse(url, ProviderPolicy.browser(url))
        }
    }

    @Test fun wrappingKeySizeAndAccountBounds() {
        ProviderPolicy.key(ByteArray(32))
        ProviderPolicy.account("synthetic-workspace:connection:key-version")
        for (size in listOf(0, 31, 33, 4096)) {
            assertThrows(StoreFailure::class.java) { ProviderPolicy.key(ByteArray(size)) }
        }
        for (account in listOf("", "nul\u0000byte", "line\nbreak", "a".repeat(241))) {
            assertThrows(StoreFailure::class.java) { ProviderPolicy.account(account) }
        }
    }

    @Test fun errorsContainOnlyLocalizationKeys() {
        assertEquals("native.ai.secureStore.missing", ProviderPolicy.error(StoreFailure("missing")))
        assertEquals("native.ai.secureStore.failed", ProviderPolicy.error(Exception("sensitive OS details")))
        assertEquals("native.ai.secureStore.invalid", ProviderPolicy.error(javax.crypto.AEADBadTagException("private")))
    }
}

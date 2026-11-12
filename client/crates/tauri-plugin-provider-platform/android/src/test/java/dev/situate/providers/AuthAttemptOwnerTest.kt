package dev.situate.providers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AuthAttemptOwnerTest {
    @Test fun cancellationKeepsOwnershipUntilCommitDrainFinishes() {
        val owner = AuthAttemptOwner()
        val exits = mutableListOf<String>()
        var ready = 0
        assertTrue(owner.reserve("first", { ready++ }, { fail("startup failed") }, exits::add))
        owner.ready("first")
        owner.ready("first")
        assertEquals(1, ready)
        owner.requestExit("first", "cancelled")
        owner.requestExit("first", "failed")
        assertEquals(listOf("cancelled"), exits)
        assertTrue(owner.matches("first"))
        assertFalse(owner.reserve("second", {}, {}, {}))
        assertTrue(owner.finish("first"))
        assertFalse(owner.finish("first"))
        assertTrue(owner.reserve("second", {}, {}, {}))
        assertFalse(owner.finish("first"))
        owner.requestExit("first", "cancelled")
        assertTrue(owner.matches("second"))
    }

    @Test fun timeoutSignalsFailureWithoutDroppingProtection() {
        val owner = AuthAttemptOwner()
        val exits = mutableListOf<String>()
        owner.reserve("active", {}, {}, exits::add)
        owner.ready("active")
        owner.requestExit("active", "failed")
        assertEquals(listOf("failed"), exits)
        assertTrue(owner.isReady("active"))
        assertTrue(owner.finish("active"))
    }

    @Test fun failedPromotionNeverAcknowledgesStartup() {
        val owner = AuthAttemptOwner()
        var failures = 0
        owner.reserve("failed", { fail("browser must not open") }, { failures++ }, { fail("not started") })
        owner.finish("failed")
        owner.ready("failed")
        assertEquals(1, failures)
        assertNull(owner.id)
    }

    @Test fun staleOrRestartedServiceCannotRestoreAnAttempt() {
        val owner = AuthAttemptOwner()
        owner.ready("old")
        owner.requestExit("old", "cancelled")
        assertFalse(owner.finish("old"))
        assertNull(owner.id)
    }

    @Test fun cancellationDuringStartupRejectsPendingInvoke() {
        val owner = AuthAttemptOwner()
        var failures = 0
        owner.reserve("starting", { fail("not ready") }, { failures++ }, {})
        owner.requestExit("starting", "cancelled")
        assertEquals(1, failures)
        assertNull(owner.id)
    }
}

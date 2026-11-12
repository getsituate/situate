import Foundation
import Security
import XCTest

@testable import ProviderPlatform

final class ProviderKeyStoreTests: XCTestCase {
    func testDeviceOnlyNonSynchronizingWriteAndUpdateWithoutDelete() throws {
        var store = ProviderKeyStore()
        var added = false
        var updated = false
        store.add = { query, _ in
            let values = query as NSDictionary
            XCTAssertEqual(values[kSecAttrSynchronizable] as? Bool, false)
            XCTAssertEqual(
                values[kSecAttrAccessible] as? String,
                kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
            XCTAssertEqual(values[kSecValueData] as? Data, Data(repeating: 7, count: 32))
            added = true
            return errSecDuplicateItem
        }
        store.update = { query, attributes in
            XCTAssertEqual((query as NSDictionary)[kSecAttrSynchronizable] as? Bool, false)
            XCTAssertEqual(
                (attributes as NSDictionary)[kSecValueData] as? Data, Data(repeating: 7, count: 32))
            updated = true
            return errSecSuccess
        }
        store.delete = { _ in
            XCTFail("Replacement must not delete the existing key")
            return errSecSuccess
        }
        try store.set("synthetic-workspace:connection", key: Data(repeating: 7, count: 32))
        XCTAssertTrue(added)
        XCTAssertTrue(updated)
    }

    func testReadMapsMissingLockAndCorruptSizeWithoutRealKeychain() throws {
        var store = ProviderKeyStore()
        for (status, key) in [
            (errSecItemNotFound, "missing"), (errSecInteractionNotAllowed, "locked"),
            (errSecNotAvailable, "unavailable"),
        ] {
            store.copy = { _, _ in status }
            XCTAssertThrowsError(try store.get("synthetic")) { error in
                XCTAssertEqual((error as? ProviderStoreError)?.key, "native.ai.secureStore.\(key)")
            }
        }
        store.copy = { _, result in
            result?.pointee = Data(repeating: 0, count: 31) as CFData
            return errSecSuccess
        }
        XCTAssertThrowsError(try store.get("synthetic")) { error in
            XCTAssertEqual((error as? ProviderStoreError)?.key, "native.ai.secureStore.invalid")
        }
        store.copy = { _, result in
            result?.pointee = Data(repeating: 8, count: 32) as CFData
            return errSecSuccess
        }
        XCTAssertEqual(try store.get("synthetic"), Data(repeating: 8, count: 32))
    }

    func testInvalidWriteNeverReachesOS() {
        var store = ProviderKeyStore()
        store.add = { _, _ in
            XCTFail("Invalid inputs must not reach Keychain")
            return errSecSuccess
        }
        XCTAssertThrowsError(try store.set("synthetic", key: Data(repeating: 0, count: 33)))
        XCTAssertThrowsError(try store.set("", key: Data(repeating: 0, count: 32)))
    }

    func testMissingDeleteIsIdempotentButLockIsNot() throws {
        var store = ProviderKeyStore()
        store.delete = { _ in errSecItemNotFound }
        try store.remove("synthetic")
        store.delete = { _ in errSecInteractionNotAllowed }
        XCTAssertThrowsError(try store.remove("synthetic"))
    }

    func testOnlyFixedProviderBrowserRoutes() {
        XCTAssertNotNil(permittedProviderURL("https://auth.openai.com/codex/device"))
        XCTAssertNotNil(
            permittedProviderURL("https://auth.openai.com/api/accounts/authorize?state=synthetic"))
        for url in [
            "http://auth.openai.com/codex/device",
            "https://auth.openai.com.evil.invalid/codex/device",
            "https://user@auth.openai.com/codex/device",
            "https://auth.openai.com/codex/device#token", "https://auth.openai.com/logout",
            "file:///tmp/secret",
        ] {
            XCTAssertNil(permittedProviderURL(url))
        }
    }
}

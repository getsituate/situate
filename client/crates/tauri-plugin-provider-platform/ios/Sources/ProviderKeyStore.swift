import Foundation
import LocalAuthentication
import Security

struct ProviderStoreError: LocalizedError {
    let key: String
    var errorDescription: String? { key }
    init(_ key: String) { self.key = "native.ai.secureStore.\(key)" }
}

struct ProviderKeyStore {
    static let service = "dev.situate.provider-wrapping-key.v1"
    var copy: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = SecItemCopyMatching
    var add: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = SecItemAdd
    var update: (CFDictionary, CFDictionary) -> OSStatus = SecItemUpdate
    var delete: (CFDictionary) -> OSStatus = SecItemDelete

    static func query(_ account: String) throws -> [String: Any] {
        guard !account.isEmpty, account.utf8.count <= 240,
            account.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) })
        else { throw ProviderStoreError("invalid") }
        let authentication = LAContext()
        authentication.interactionNotAllowed = true
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
            kSecUseAuthenticationContext as String: authentication,
        ]
    }

    static func check(_ status: OSStatus) throws {
        switch status {
        case errSecSuccess: return
        case errSecItemNotFound: throw ProviderStoreError("missing")
        case errSecInteractionNotAllowed, errSecAuthFailed: throw ProviderStoreError("locked")
        case errSecNotAvailable: throw ProviderStoreError("unavailable")
        default: throw ProviderStoreError("failed")
        }
    }

    func get(_ account: String) throws -> Data {
        var query = try Self.query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        try Self.check(copy(query as CFDictionary, &result))
        guard let data = result as? Data, data.count == 32 else {
            throw ProviderStoreError("invalid")
        }
        return data
    }

    func set(_ account: String, key: Data) throws {
        guard key.count == 32 else { throw ProviderStoreError("invalid") }
        let query = try Self.query(account)
        let values: [String: Any] = [
            kSecValueData as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var item = query
        item.removeValue(forKey: kSecUseAuthenticationContext as String)
        item.merge(values) { _, new in new }
        let result = add(item as CFDictionary, nil)
        if result == errSecDuplicateItem {
            try Self.check(update(query as CFDictionary, values as CFDictionary))
        } else {
            try Self.check(result)
        }
    }

    func remove(_ account: String) throws {
        let status = delete(try Self.query(account) as CFDictionary)
        if status != errSecItemNotFound { try Self.check(status) }
    }

    func availability() throws {
        do { _ = try get("availability-probe") } catch let error as ProviderStoreError
            where error.key == "native.ai.secureStore.missing"
        { return }
    }

    static func directory() throws -> URL {
        var directory = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        ).appendingPathComponent("provider-credentials", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directory.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        return directory
    }
}

func permittedProviderURL(_ raw: String) -> URL? {
    guard let parts = URLComponents(string: raw), parts.scheme == "https", parts.port == nil,
        parts.user == nil, parts.password == nil, parts.fragment == nil,
        let host = parts.host, let url = parts.url
    else { return nil }
    let paths: [String: Set<String>] = [
        "auth.openai.com": ["/api/accounts/authorize", "/oauth/authorize", "/codex/device"],
        "openrouter.ai": ["/auth"],
    ]
    return paths[host]?.contains(parts.percentEncodedPath) == true ? url : nil
}

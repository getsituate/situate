import Darwin
import Foundation

struct WorkspaceContentError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum ContentPathPolicy { case providerReadable, portableWritable }

func contentComponents(
    _ path: String, allowRoot: Bool = false, policy: ContentPathPolicy = .providerReadable
) throws -> [String] {
    if allowRoot && path.isEmpty { return [] }
    let parts = path.components(separatedBy: "/")
    guard
        parts.allSatisfy({ part in
            let alias = String(part.reversed().drop(while: { $0 == " " || $0 == "." }).reversed())
            let lower = alias.lowercased()
            let safe =
                !alias.isEmpty && !part.contains("\\") && !part.contains(":")
                && !part.contains("\0") && !lower.hasPrefix(".situate-write-")
                && ![".git", ".situate"].contains(lower)
            let portable =
                !part.unicodeScalars.contains { $0.value <= 31 || (127...159).contains($0.value) }
                && !part.hasSuffix(" ") && !part.hasSuffix(".")
            return safe && (policy == .providerReadable || portable)
        })
    else {
        throw WorkspaceContentError(message: "native.provider.path.unsafe")
    }
    return parts
}

struct WorkspaceContentEntry: Equatable {
    let name: String
    let directory: Bool
}

/// An observed read, not a persistent file identity or a conditional-write token.
struct WorkspaceContentSnapshot {
    let bytes: Data
    let identity: String
}

final class WorkspaceWriteCoordination {
    private let queue = DispatchQueue(
        label: "dev.situate.workspace-coordination", attributes: .concurrent)
    private let lock = NSLock()
    private let coordinate: (URL, (URL) -> Void) -> Error?
    private var active: [String: (release: DispatchSemaphore, finished: DispatchGroup)] = [:]

    init(
        coordinate: @escaping (URL, (URL) -> Void) -> Error? = { root, accessor in
            var error: NSError?
            NSFileCoordinator(filePresenter: nil).coordinate(
                writingItemAt: root, options: [], error: &error, byAccessor: accessor)
            return error
        }
    ) {
        self.coordinate = coordinate
    }

    func begin(
        at root: URL, finished: @escaping () -> Void = {},
        started: @escaping (Result<String, Error>) -> Void
    ) {
        queue.async {
            defer { finished() }
            var completion: DispatchGroup?
            let error = self.coordinate(root) { coordinated in
                guard coordinated.standardizedFileURL == root.standardizedFileURL else { return }
                let id = UUID().uuidString
                let release = DispatchSemaphore(value: 0)
                let finished = DispatchGroup()
                finished.enter()
                self.lock.lock()
                self.active[id] = (release, finished)
                self.lock.unlock()
                completion = finished
                started(.success(id))
                release.wait()
            }
            if let completion = completion {
                completion.leave()
            } else {
                started(
                    .failure(
                        error
                            ?? WorkspaceContentError(
                                message: "native.provider.coordination.failed")))
            }
        }
    }

    func end(_ token: String) throws {
        lock.lock()
        let entry = active[token]
        lock.unlock()
        guard let entry = entry else { return }
        entry.release.signal()
        entry.finished.wait()
        lock.lock()
        active.removeValue(forKey: token)
        lock.unlock()
    }
}

struct WorkspaceSecurityScope {
    var start: (URL) -> Bool = { $0.startAccessingSecurityScopedResource() }
    var stop: (URL) -> Void = { $0.stopAccessingSecurityScopedResource() }
}

final class WorkspaceSessionGrants {
    private let lock = NSLock()
    private let scope: WorkspaceSecurityScope
    private var grants: [String: (root: URL, scoped: Bool, references: Int)] = [:]

    init(scope: WorkspaceSecurityScope = WorkspaceSecurityScope()) {
        self.scope = scope
    }

    func begin(at root: URL, securityScoped: Bool, validate: () throws -> Void) throws -> String {
        if securityScoped && !scope.start(root) {
            throw WorkspaceContentError(message: "native.provider.access.grantAgain")
        }
        do { try validate() } catch {
            if securityScoped { scope.stop(root) }
            throw error
        }
        let token = UUID().uuidString
        lock.lock()
        grants[token] = (root, securityScoped, 1)
        lock.unlock()
        return token
    }

    func root(for token: String) throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        guard let grant = grants[token] else {
            throw WorkspaceContentError(message: "native.provider.workspace.unavailable")
        }
        return grant.root
    }

    func retain(_ token: String) throws -> URL {
        lock.lock()
        defer { lock.unlock() }
        guard var grant = grants[token] else {
            throw WorkspaceContentError(message: "native.provider.workspace.unavailable")
        }
        grant.references += 1
        grants[token] = grant
        return grant.root
    }

    func end(_ token: String) {
        lock.lock()
        guard var grant = grants[token] else {
            lock.unlock()
            return
        }
        grant.references -= 1
        if grant.references == 0 {
            grants.removeValue(forKey: token)
        } else {
            grants[token] = grant
        }
        lock.unlock()
        if grant.references == 0 && grant.scoped { scope.stop(grant.root) }
    }

    deinit {
        for grant in grants.values where grant.scoped { scope.stop(grant.root) }
    }
}

/// Native-only content access. The lifecycle supplies a resolved workspace URL;
/// bookmark URLs must use securityScoped access for the entire operation.
/// Coordination orders cooperating writers, not arbitrary POSIX writers.
final class WorkspaceContent {
    enum Access { case appLocal, securityScoped }
    enum ReplacementCapability { case requiresVersionedWriter, unverifiedProviderReplacement }
    private let root: URL
    private let access: Access
    private let scope: WorkspaceSecurityScope

    init(root: URL, access: Access, scope: WorkspaceSecurityScope = WorkspaceSecurityScope()) throws
    {
        guard root.isFileURL else {
            throw WorkspaceContentError(message: "native.provider.workspace.fileUrlRequired")
        }
        self.root = root
        self.access = access
        self.scope = scope
    }

    var replacementCapability: ReplacementCapability {
        access == .appLocal ? .requiresVersionedWriter : .unverifiedProviderReplacement
    }

    func list(_ path: String = "") throws -> [WorkspaceContentEntry] {
        let parts = try contentComponents(path, allowRoot: true)
        return try coordinated(parts: parts, directory: true) { root in
            try self.withDirectory(root, parts: parts) { directory in
                let copy = dup(directory.fd)
                guard copy >= 0 else {
                    throw WorkspaceContentError(message: "native.provider.folder.readFailed")
                }
                guard let stream = fdopendir(copy) else {
                    close(copy)
                    throw WorkspaceContentError(message: "native.provider.folder.readFailed")
                }
                defer { closedir(stream) }
                var result: [WorkspaceContentEntry] = []
                while true {
                    errno = 0
                    guard let entry = readdir(stream) else {
                        guard errno == 0 else {
                            throw WorkspaceContentError(
                                message: "native.provider.folder.listIncomplete")
                        }
                        return result.sorted { $0.name < $1.name }
                    }
                    let name = withUnsafePointer(to: &entry.pointee.d_name) {
                        $0.withMemoryRebound(
                            to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1
                        ) { String(cString: $0) }
                    }
                    guard (try? contentComponents(name)) != nil else { continue }
                    var info = stat()
                    guard fstatat(directory.fd, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else {
                        throw WorkspaceContentError(message: "native.provider.folder.changed")
                    }
                    let type = info.st_mode & S_IFMT
                    if type == S_IFREG || type == S_IFDIR {
                        result.append(WorkspaceContentEntry(name: name, directory: type == S_IFDIR))
                    }
                }
            }
        }
    }

    func read(_ path: String, maxBytes: Int) throws -> WorkspaceContentSnapshot {
        let parts = try contentComponents(path)
        return try readParts(parts, maxBytes: maxBytes, missingAllowed: false)!
    }

    func localization() throws -> Data? {
        try readParts([".situate", "localization.json"], maxBytes: 65_536, missingAllowed: true)?
            .bytes
    }

    func workingMethod() throws -> Data? {
        try readParts([".situate", "working-method.md"], maxBytes: 65_536, missingAllowed: true)?
            .bytes
    }

    func appearance() throws -> Data? {
        try readParts([".situate", "appearance.json"], maxBytes: 65_536, missingAllowed: true)?
            .bytes
    }

    private func readParts(_ parts: [String], maxBytes: Int, missingAllowed: Bool) throws
        -> WorkspaceContentSnapshot?
    {
        guard (1...16 * 1024 * 1024).contains(maxBytes) else {
            throw WorkspaceContentError(message: "native.provider.read.limitInvalid")
        }
        return try coordinated(
            parts: missingAllowed ? Array(parts.dropLast()) : parts, directory: missingAllowed
        ) { root in
            try self.withDirectory(root, parts: Array(parts.dropLast())) { parent in
                let fd = openat(
                    parent.fd, parts.last!, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
                if fd < 0 && errno == ENOENT && missingAllowed { return nil }
                guard fd >= 0 else {
                    throw WorkspaceContentError(message: "native.provider.file.openUnsafe")
                }
                defer { close(fd) }
                var before = stat()
                guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG else {
                    throw WorkspaceContentError(message: "native.provider.file.regularOnly")
                }
                let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
                var bytes = Data()
                while let chunk = try handle.read(upToCount: min(8192, maxBytes - bytes.count + 1)),
                    !chunk.isEmpty
                {
                    guard bytes.count + chunk.count <= maxBytes else {
                        throw WorkspaceContentError(message: "native.provider.read.tooLarge")
                    }
                    bytes.append(chunk)
                }
                var after = stat()
                var current = stat()
                guard fstat(fd, &after) == 0,
                    fstatat(parent.fd, parts.last!, &current, AT_SYMLINK_NOFOLLOW) == 0,
                    current.st_mode & S_IFMT == S_IFREG,
                    before.st_dev == current.st_dev, before.st_ino == current.st_ino,
                    before.st_size == after.st_size,
                    before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
                    before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
                    before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
                    before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
                else {
                    throw WorkspaceContentError(message: "native.provider.file.changed")
                }
                return WorkspaceContentSnapshot(
                    bytes: bytes, identity: "\(before.st_dev):\(before.st_ino)")
            }
        }
    }

    /// No truncation or replacement occurs. A provider URL and NSFileCoordinator
    /// alone do not establish conditional atomic replacement or durable history.
    /// Base and draft remain caller-owned, including when this operation fails.
    func replace(_ path: String, expected: WorkspaceContentSnapshot, draft: Data) throws -> Never {
        _ = try contentComponents(path)
        throw WorkspaceContentError(message: "native.provider.write.versioningRequired")
    }

    private func coordinated<T>(
        parts: [String], directory: Bool = false, _ operation: (URL) throws -> T
    ) throws -> T {
        let scoped = access == .securityScoped
        if scoped && !scope.start(root) {
            throw WorkspaceContentError(message: "native.provider.workspace.grantAgain")
        }
        defer { if scoped { scope.stop(root) } }
        // Reject links and special files before asking a provider to coordinate them.
        if directory {
            try withDirectory(root, parts: parts) { _ in () }
        } else {
            try withDirectory(root, parts: Array(parts.dropLast())) { parent in
                var info = stat()
                guard let name = parts.last,
                    fstatat(parent.fd, name, &info, AT_SYMLINK_NOFOLLOW) == 0,
                    info.st_mode & S_IFMT == S_IFREG
                else {
                    throw WorkspaceContentError(message: "native.provider.file.regularOnly")
                }
            }
        }
        var coordinationError: NSError?
        var outcome: Result<T, Error>?
        let item = parts.reduce(root) { $0.appendingPathComponent($1) }
        NSFileCoordinator(filePresenter: nil).coordinate(
            readingItemAt: item, options: [], error: &coordinationError
        ) { url in
            outcome = Result {
                guard url.standardizedFileURL == item.standardizedFileURL else {
                    throw WorkspaceContentError(message: "native.provider.content.locationChanged")
                }
                return try operation(self.root)
            }
        }
        if let error = coordinationError { throw error }
        guard let result = outcome else {
            throw WorkspaceContentError(message: "native.provider.coordination.contentUnsupported")
        }
        return try result.get()
    }

    private func withDirectory<T>(
        _ root: URL, parts: [String], operation: (DirectoryHandle) throws -> T
    ) throws -> T {
        let first = try DirectoryHandle(at: root.path)
        var handles = [first]
        for part in parts {
            handles.append(try DirectoryHandle(at: part, relativeTo: handles.last!.fd))
        }
        let result = try operation(handles.last!)
        try first.requireAt(root.path)
        for (index, part) in parts.enumerated() {
            try handles[index + 1].requireAt(part, relativeTo: handles[index].fd)
        }
        return result
    }
}

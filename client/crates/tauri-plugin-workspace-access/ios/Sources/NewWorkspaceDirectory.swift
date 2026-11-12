import Darwin
import Foundation

func nativeMessage(_ error: Error) -> String {
    let message = error.localizedDescription
    return message.hasPrefix("native.") || message.hasPrefix("{")
        ? message : "native.provider.content.failed"
}

func nativeError(_ key: String, path: String, error: Error) -> String {
    nativeText(key, params: ["path": path, "error": nativeMessage(error)])
}

func nativeText(_ key: String, params: [String: Any]) -> String {
    let value: [String: Any] = ["key": key, "params": params]
    guard let data = try? JSONSerialization.data(withJSONObject: value),
        let text = String(data: data, encoding: .utf8)
    else { return "native.provider.content.failed" }
    return text
}

struct DirectoryCreationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

final class DirectoryHandle {
    let fd: Int32
    private let identity: stat

    init(at path: String, relativeTo parent: Int32 = AT_FDCWD) throws {
        let opened = openat(parent, path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard opened >= 0 else {
            throw DirectoryCreationError(message: "native.provider.folder.openUnsafe")
        }
        var info = stat()
        guard fstat(opened, &info) == 0 else {
            close(opened)
            throw DirectoryCreationError(message: "native.provider.folder.identityFailed")
        }
        fd = opened
        identity = info
    }
    deinit { close(fd) }

    func requireAt(_ path: String, relativeTo parent: Int32 = AT_FDCWD) throws {
        var current = stat()
        guard fstatat(parent, path, &current, AT_SYMLINK_NOFOLLOW) == 0,
            current.st_mode & S_IFMT == S_IFDIR,
            current.st_dev == identity.st_dev, current.st_ino == identity.st_ino
        else {
            throw DirectoryCreationError(message: "native.workspace.create.locationChanged")
        }
    }
    func requireEmpty() throws {
        let copy = dup(fd)
        guard copy >= 0 else {
            throw DirectoryCreationError(message: "native.workspace.create.readFailed")
        }
        guard let directory = fdopendir(copy) else {
            close(copy)
            throw DirectoryCreationError(message: "native.workspace.create.readFailed")
        }
        defer { closedir(directory) }
        rewinddir(directory)
        while true {
            errno = 0
            guard let entry = readdir(directory) else {
                guard errno == 0 else {
                    throw DirectoryCreationError(message: "native.workspace.create.readFailed")
                }
                return
            }
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) {
                    String(cString: $0)
                }
            }
            if name != "." && name != ".." {
                throw DirectoryCreationError(message: "native.provider.create.nonempty")
            }
        }
    }
}

final class NewWorkspaceDirectory {
    private let parent: DirectoryHandle
    private let child: DirectoryHandle
    private let parentURL: URL
    private let name: String
    let url: URL

    init(parentURL: URL, name: String) throws {
        self.parentURL = parentURL
        self.name = name
        url = parentURL.appendingPathComponent(name, isDirectory: true)
        parent = try DirectoryHandle(at: parentURL.path)
        guard mkdirat(parent.fd, name, 0o700) == 0 else {
            throw DirectoryCreationError(
                message: errno == EEXIST
                    ? "native.workspace.folder.exists" : "native.provider.folder.createFailed")
        }
        do { child = try DirectoryHandle(at: name, relativeTo: parent.fd) } catch {
            throw DirectoryCreationError(
                message: nativeError(
                    "native.provider.create.partialDirectory", path: url.path, error: error))
        }
    }
    func initialize() throws {
        try requireCurrent()
        // mkdirat cannot return a handle atomically. Reject nonempty replacements
        // acquired before openat; subsequent writes use only the held child.
        try child.requireEmpty()
        guard mkdirat(child.fd, ".situate", 0o700) == 0 else {
            throw DirectoryCreationError(message: "native.workspace.create.markerFailed")
        }
        guard WorkspaceIdentity.admit(root: child) != nil,
            fsync(child.fd) == 0, fsync(parent.fd) == 0
        else {
            throw DirectoryCreationError(message: "native.workspace.create.markerFailed")
        }
        try requireCurrent()
    }
    func requireCurrent() throws {
        try parent.requireAt(parentURL.path)
        try child.requireAt(name, relativeTo: parent.fd)
    }
}

enum WorkspaceIdentity {
    static func validate(_ data: Data) -> String? {
        guard data.count <= 1024,
            let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(value.keys) == Set(["version", "id"]),
            let version = value["version"] as? NSNumber,
            CFGetTypeID(version) != CFBooleanGetTypeID(), version.stringValue == "1",
            let id = value["id"] as? String,
            id.range(
                of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                options: .regularExpression) != nil,
            let text = String(data: data, encoding: .utf8),
            !text.contains("\\"),
            text.range(of: #""version"\s*:\s*1\s*[,}]"#, options: .regularExpression) != nil,
            text.components(separatedBy: "\"id\"").count == 2,
            text.components(separatedBy: "\"version\"").count == 2
        else { return nil }
        return id
    }

    static func admit(at url: URL) -> String? {
        guard let root = try? DirectoryHandle(at: url.path) else { return nil }
        return admit(root: root)
    }

    private static func read(marker: DirectoryHandle) -> String? {
        let fd = openat(marker.fd, "workspace.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
            info.st_size <= 1024
        else { return nil }
        var bytes = [UInt8](repeating: 0, count: 1025)
        var count = 0
        while count < bytes.count {
            let length = bytes.withUnsafeMutableBytes {
                Darwin.read(fd, $0.baseAddress!.advanced(by: count), $0.count - count)
            }
            if length < 0 { return nil }
            if length == 0 { break }
            count += length
        }
        return validate(Data(bytes.prefix(count)))
    }

    static func admit(root: DirectoryHandle) -> String? {
        guard let marker = try? DirectoryHandle(at: ".situate", relativeTo: root.fd) else {
            return nil
        }
        var info = stat()
        if fstatat(marker.fd, "workspace.json", &info, AT_SYMLINK_NOFOLLOW) == 0 {
            return read(marker: marker)
        }
        guard errno == ENOENT, fstat(root.fd, &info) == 0, info.st_mode & 0o222 != 0,
            fstat(marker.fd, &info) == 0, info.st_mode & 0o222 != 0
        else {
            return nil
        }
        let id = UUID().uuidString.lowercased()
        let temporary = ".workspace-\(UUID().uuidString).tmp"
        let fd = openat(
            marker.fd, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return nil }
        defer {
            close(fd)
            unlinkat(marker.fd, temporary, 0)
        }
        let data = Data("{\"version\":1,\"id\":\"\(id)\"}\n".utf8)
        var count = 0
        while count < data.count {
            let length = data.withUnsafeBytes {
                Darwin.write(fd, $0.baseAddress!.advanced(by: count), $0.count - count)
            }
            guard length > 0 else { return nil }
            count += length
        }
        guard fsync(fd) == 0 else { return nil }
        // linkat publishes complete bytes without replacing a concurrent admission.
        if linkat(marker.fd, temporary, marker.fd, "workspace.json", 0) != 0 {
            guard errno == EEXIST else { return nil }
        } else if fsync(marker.fd) != 0 {
            return nil
        }
        return read(marker: marker)
    }
}

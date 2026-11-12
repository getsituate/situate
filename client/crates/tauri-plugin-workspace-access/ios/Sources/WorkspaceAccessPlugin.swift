import Darwin
import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

private struct Location: Codable {
    var id: String
    var name: String
    var display: String
    var kind: String
    var handle: String

    var json: [String: Any] {
        ["id": id, "name": name, "display": display, "kind": kind, "handle": handle]
    }
}
private struct RecoveryEmailArgs: Decodable {
    var url: String
}
private struct AccessArgs: Decodable {
    var operation: String
    var location: Location?
    var name: String?
}
private struct ContentArgs: Decodable {
    var operation: String
    var location: Location?
    var path: String?
    var text: String?
    var token: String?
}
private struct AccessError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

class WorkspaceAccessPlugin: Plugin, UIDocumentPickerDelegate {
    private var pending: Invoke?
    private let queue = DispatchQueue(label: "dev.situate.workspace-access")
    private let contentQueue = DispatchQueue(
        label: "dev.situate.workspace-content", attributes: .concurrent)
    private let coordinations = WorkspaceWriteCoordination()
    private let sessionGrants = WorkspaceSessionGrants()

    @objc public func recoveryEmail(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RecoveryEmailArgs.self)
        guard args.url.utf8.count <= 24576,
            let components = URLComponents(string: args.url),
            components.scheme == "mailto", components.path == "bugs@getsituate.com",
            components.fragment == nil,
            let items = components.queryItems, items.count == 2,
            items[0].name == "subject", items[0].value == "Situate problem report",
            items[1].name == "body", let body = items[1].value,
            body.utf8.count <= 8192, let url = components.url
        else {
            invoke.resolve(false)
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in invoke.resolve(opened) }
        }
    }

    @objc public func content(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ContentArgs.self)
        contentQueue.async {
            do {
                if args.operation == "endSession" {
                    self.sessionGrants.end(args.token ?? "")
                    invoke.resolve([:])
                    return
                }
                if args.operation == "beginPreparation" {
                    let sessionToken = args.token ?? ""
                    let root = try self.sessionGrants.retain(sessionToken)
                    self.coordinations.begin(
                        at: root, finished: { self.sessionGrants.end(sessionToken) }
                    ) { result in
                        switch result {
                        case .success(let token): invoke.resolve(["token": token])
                        case .failure(let error): invoke.reject(error.localizedDescription)
                        }
                    }
                    return
                }
                if args.operation == "endAccess" {
                    try self.coordinations.end(args.token ?? "")
                    invoke.resolve([:])
                    return
                }
                if args.operation == "export" {
                    throw AccessError(message: "native.provider.export.unsupported")
                }
                guard let location = args.location else {
                    throw AccessError(message: "native.provider.workspace.unavailable")
                }
                let root = try self.resolve(location)
                if args.operation == "beginSession" {
                    let token = try self.sessionGrants.begin(
                        at: root, securityScoped: location.kind == "ios-bookmark"
                    ) {
                        try self.requireDirectory(root)
                    }
                    invoke.resolve(["token": token, "path": root.path])
                    return
                }
                if args.operation == "beginAccess" {
                    guard location.kind == "ios-documents" else {
                        throw AccessError(message: "native.provider.workspace.readOnly")
                    }
                    self.coordinations.begin(at: root) { result in
                        switch result {
                        case .success(let token): invoke.resolve(["token": token])
                        case .failure(let error): invoke.reject(error.localizedDescription)
                        }
                    }
                    return
                }
                if args.operation == "localRoot" {
                    guard location.kind == "ios-documents" else {
                        throw AccessError(message: "native.provider.localRoot.unsupported")
                    }
                    try self.requireDirectory(root, writable: false)
                    invoke.resolve(["path": root.path])
                    return
                }
                let content = try WorkspaceContent(
                    root: root,
                    access: location.kind == "ios-bookmark" ? .securityScoped : .appLocal)
                let path = args.path ?? ""
                switch args.operation {
                case "localization":
                    if let bytes = try content.localization() {
                        guard let text = String(data: bytes, encoding: .utf8) else {
                            throw AccessError(message: "native.localization.invalid")
                        }
                        invoke.resolve(["text": text])
                    } else {
                        invoke.resolve([:])
                    }
                case "workingMethod":
                    if let bytes = try content.workingMethod() {
                        guard let text = String(data: bytes, encoding: .utf8) else {
                            throw AccessError(message: "native.content.file.invalidUtf8")
                        }
                        invoke.resolve(["text": text])
                    } else {
                        invoke.resolve([:])
                    }
                case "appearance":
                    if let bytes = try content.appearance() {
                        guard let text = String(data: bytes, encoding: .utf8) else {
                            throw AccessError(message: "native.appearance.invalid")
                        }
                        invoke.resolve(["text": text])
                    } else {
                        invoke.resolve([:])
                    }
                case "list":
                    invoke.resolve([
                        "entries": try content.list(path).map {
                            ["name": $0.name, "directory": $0.directory] as [String: Any]
                        }
                    ])
                case "read":
                    invoke.resolve([
                        "base64": try content.read(path, maxBytes: 16 * 1024 * 1024).bytes
                            .base64EncodedString()
                    ])
                case "openExternal":
                    if let url = URL(string: path),
                        ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil
                    {
                        DispatchQueue.main.async {
                            UIApplication.shared.open(url) { success in
                                if success {
                                    invoke.resolve([:])
                                } else {
                                    invoke.reject("native.provider.link.openFailed")
                                }
                            }
                        }
                    } else {
                        let bytes = try content.read(path, maxBytes: 16 * 1024 * 1024).bytes
                        let directory = FileManager.default.temporaryDirectory
                            .appendingPathComponent(UUID().uuidString, isDirectory: true)
                        try FileManager.default.createDirectory(
                            at: directory, withIntermediateDirectories: false)
                        let copy = directory.appendingPathComponent(
                            (path as NSString).lastPathComponent)
                        try bytes.write(to: copy, options: .withoutOverwriting)
                        DispatchQueue.main.async {
                            guard let controller = self.manager.viewController else {
                                invoke.reject("native.provider.viewer.unavailable")
                                return
                            }
                            let sheet = UIActivityViewController(
                                activityItems: [copy], applicationActivities: nil)
                            sheet.popoverPresentationController?.sourceView = controller.view
                            sheet.completionWithItemsHandler = { _, completed, _, error in
                                if let error = error {
                                    invoke.reject(error.localizedDescription)
                                } else if completed {
                                    invoke.resolve([:])
                                } else {
                                    invoke.reject("native.provider.open.cancelled")
                                }
                            }
                            controller.present(sheet, animated: true)
                        }
                    }
                default: throw AccessError(message: "native.provider.operation.unknown")
                }
            } catch { invoke.reject(error.localizedDescription) }
        }
    }

    @objc public func access(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AccessArgs.self)
        if args.operation == "pick" {
            DispatchQueue.main.async {
                guard self.pending == nil else {
                    invoke.reject("native.provider.picker.alreadyOpen")
                    return
                }
                guard let controller = self.manager.viewController else {
                    invoke.reject("native.workspace.picker.unavailable")
                    return
                }
                self.pending = invoke
                let picker = UIDocumentPickerViewController(
                    forOpeningContentTypes: [.folder], asCopy: false)
                picker.allowsMultipleSelection = false
                picker.delegate = self
                controller.present(picker, animated: true)
            }
            return
        }
        queue.async {
            do {
                if args.operation == "diagnosticsDirectory" {
                    guard
                        let support = FileManager.default.urls(
                            for: .applicationSupportDirectory, in: .userDomainMask
                        ).first
                    else {
                        throw AccessError(message: "native.provider.documents.unavailable")
                    }
                    var directory = support.appendingPathComponent("diagnostics", isDirectory: true)
                    try FileManager.default.createDirectory(
                        at: directory, withIntermediateDirectories: true,
                        attributes: [.posixPermissions: 0o700])
                    let directoryHandle = try DirectoryHandle(at: directory.path)
                    try directoryHandle.requireAt(directory.path)
                    var values = URLResourceValues()
                    values.isExcludedFromBackup = true
                    try directory.setResourceValues(values)
                    try directoryHandle.requireAt(directory.path)
                    let version = ProcessInfo.processInfo.operatingSystemVersion
                    invoke.resolve([
                        "directory": directory.path,
                        "platformVersion":
                            "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)",
                    ])
                    return
                }
                if args.operation == "default" {
                    guard
                        let url = FileManager.default.urls(
                            for: .documentDirectory, in: .userDomainMask
                        ).first,
                        FileManager.default.isReadableFile(atPath: url.path)
                    else {
                        invoke.resolve([:])
                        return
                    }
                    invoke.resolve(["location": try self.location(url).json])
                    return
                }
                guard let loc = args.location else {
                    throw AccessError(message: "native.workspace.folder.choose")
                }
                let url = try self.resolve(loc)
                let scoped = loc.kind == "ios-bookmark"
                if scoped && !url.startAccessingSecurityScopedResource() {
                    throw AccessError(message: "native.provider.access.grantAgain")
                }
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                if args.operation == "identity" {
                    var identity: String?
                    var coordinationError: NSError?
                    NSFileCoordinator(filePresenter: nil).coordinate(
                        writingItemAt: url, options: [], error: &coordinationError
                    ) {
                        identity = WorkspaceIdentity.admit(at: $0)
                    }
                    invoke.resolve(identity.map { ["workspaceId": $0] } ?? [:])
                    return
                }
                let result = try self.operate(args, url)
                invoke.resolve(["location": result.json])
            } catch { invoke.reject(error.localizedDescription) }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve([:])
        pending = nil
    }
    public func documentPicker(
        _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
    ) {
        guard let invoke = pending else { return }
        pending = nil
        guard let url = urls.first else {
            invoke.resolve([:])
            return
        }
        queue.async {
            let granted = url.startAccessingSecurityScopedResource()
            defer { if granted { url.stopAccessingSecurityScopedResource() } }
            do {
                try self.requireDirectory(url)
                invoke.resolve(["location": try self.location(url).json])
            } catch { invoke.reject(error.localizedDescription) }
        }
    }
    private func documents() throws -> URL {
        guard let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        else {
            throw AccessError(message: "native.provider.documents.unavailable")
        }
        return url.resolvingSymlinksInPath().standardizedFileURL
    }
    private func location(_ input: URL) throws -> Location {
        let url = input.resolvingSymlinksInPath().standardizedFileURL
        let root = try documents()
        if url == root || url.path.hasPrefix(root.path + "/") {
            let relative = url == root ? "" : String(url.path.dropFirst(root.path.count + 1))
            return Location(
                id: "ios-documents:" + relative,
                name: relative.isEmpty ? "native.provider.documents.name" : url.lastPathComponent,
                display: relative.isEmpty
                    ? "native.provider.documents.name"
                    : nativeText("native.provider.documents.path", params: ["path": relative]),
                kind: "ios-documents", handle: relative.isEmpty ? "." : relative)
        }
        // iOS bookmarks carry the picker grant; macOS-only .withSecurityScope is not available here.
        let data = try url.bookmarkData(
            options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        return Location(
            id: "ios:" + url.path, name: url.lastPathComponent,
            display: url.path, kind: "ios-bookmark", handle: data.base64EncodedString())
    }
    private func resolve(_ loc: Location) throws -> URL {
        if loc.kind == "ios-documents" {
            let root = try documents()
            let url = root.appendingPathComponent(loc.handle).resolvingSymlinksInPath()
                .standardizedFileURL
            guard url == root || url.path.hasPrefix(root.path + "/") else {
                throw AccessError(message: "native.provider.documents.outside")
            }
            return url
        }
        guard loc.kind == "ios-bookmark", let data = Data(base64Encoded: loc.handle) else {
            throw AccessError(message: "native.provider.handle.unsupported")
        }
        var stale = false
        do {
            return try URL(
                resolvingBookmarkData: data, options: .withoutUI, relativeTo: nil,
                bookmarkDataIsStale: &stale)
        } catch {
            throw AccessError(message: "native.provider.access.grantAgain")
        }
    }
    private func requireDirectory(_ url: URL, writable: Bool = true) throws {
        let values = try url.resourceValues(forKeys: [
            .isDirectoryKey, .isReadableKey, .isWritableKey, .ubiquitousItemDownloadingStatusKey,
        ])
        guard values.isDirectory == true, values.isReadable == true,
            !writable || values.isWritable == true
        else {
            throw AccessError(message: "native.provider.folder.readOnly")
        }
        if let status = values.ubiquitousItemDownloadingStatus, status != .current {
            throw AccessError(message: "native.provider.folder.downloadRequired")
        }
        _ = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
    }
    private func operate(_ args: AccessArgs, _ url: URL) throws -> Location {
        var coordinationError: NSError?
        var outcome: Result<Location, Error>?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(writingItemAt: url, options: [], error: &coordinationError) {
            parent in
            outcome = Result {
                try self.requireDirectory(parent)
                if args.operation == "inspect" {
                    let marker = parent.appendingPathComponent(".situate", isDirectory: true)
                    guard
                        (try? marker.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                    else {
                        throw AccessError(message: "native.workspace.folder.notWorkspace")
                    }
                    _ = try FileManager.default.contentsOfDirectory(
                        at: marker, includingPropertiesForKeys: nil)
                    return try self.location(parent)
                }
                guard ["preflight", "create"].contains(args.operation),
                    let name = args.name,
                    !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    name != ".", name != "..", !name.contains("/"), !name.contains("\\"),
                    !name.contains("\0")
                else { throw AccessError(message: "native.provider.workspace.nameInvalid") }
                let child = parent.appendingPathComponent(name, isDirectory: true)
                var info = stat()
                if lstat(child.path, &info) == 0 {
                    throw AccessError(message: "native.workspace.folder.exists")
                }
                guard errno == ENOENT else {
                    throw AccessError(message: "native.provider.create.checkFailed")
                }
                if args.operation == "preflight" { return try self.location(parent) }
                let directory = try NewWorkspaceDirectory(parentURL: parent, name: name)
                do {
                    try directory.initialize()
                    let result = try self.location(directory.url)
                    try directory.requireCurrent()
                    return result
                } catch {
                    throw AccessError(
                        message: nativeError(
                            "native.provider.create.partialWorkspace", path: child.path,
                            error: error))
                }
            }
        }
        if let error = coordinationError { throw error }
        guard let outcome = outcome else {
            throw AccessError(message: "native.provider.coordination.folderUnsupported")
        }
        return try outcome.get()
    }
}

@_cdecl("init_plugin_workspace_access")
public func initWorkspaceAccess() -> Plugin { WorkspaceAccessPlugin() }

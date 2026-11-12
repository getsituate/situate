import Darwin
import Foundation

func expectFailure(line: UInt = #line, _ operation: () throws -> Void) {
    do {
        try operation()
        fatalError("Expected content access to fail at line \(line)")
    } catch {}
}

struct PathCase: Decodable {
    let path: String
    let provider: Bool
    let portable: Bool
}
let cases = try JSONDecoder().decode(
    [PathCase].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
precondition(!cases.isEmpty)
for test in cases {
    for (policy, accepted) in [
        (ContentPathPolicy.providerReadable, test.provider), (.portableWritable, test.portable),
    ] {
        let parts = try? contentComponents(test.path, policy: policy)
        precondition(
            (parts != nil) == accepted, "Path policy mismatch: \(test.path.debugDescription)")
        if let parts = parts { precondition(parts.joined(separator: "/") == test.path) }
    }
}
let rootParts = try contentComponents("", allowRoot: true)
precondition(rootParts == [])

let files = FileManager.default
let root = files.temporaryDirectory.appendingPathComponent(
    "workspace-content-" + UUID().uuidString, isDirectory: true)
try files.createDirectory(at: root, withIntermediateDirectories: false)
defer { try? files.removeItem(at: root) }
for folder in [".situate", ".git", ".situate-write-pending", "Notes"] {
    try files.createDirectory(
        at: root.appendingPathComponent(folder), withIntermediateDirectories: false)
}
let note = root.appendingPathComponent("Notes/note.md")
let original = Data([0, 255, 65, 10])
try original.write(to: note)
try Data("private".utf8).write(to: root.appendingPathComponent(".situate/state"))
try files.createSymbolicLink(
    at: root.appendingPathComponent("alias"),
    withDestinationURL: root.appendingPathComponent(".situate"))
try files.createSymbolicLink(
    at: root.appendingPathComponent("Notes/link"), withDestinationURL: note)
let content = try WorkspaceContent(root: root, access: .appLocal)
precondition(content.replacementCapability == .requiresVersionedWriter)
let entries = try content.list()
precondition(entries == [WorkspaceContentEntry(name: "Notes", directory: true)])
let nested = try content.list("Notes")
precondition(nested == [WorkspaceContentEntry(name: "note.md", directory: false)])
let snapshot = try content.read("Notes/note.md", maxBytes: 4)
precondition(snapshot.bytes == original)
precondition(!snapshot.identity.isEmpty)
for path in [
    "", "/Notes/note.md", "Notes//note.md", "Notes/../note.md", "./Notes", "Notes/",
    "Notes\\note.md", "Notes\0x", ".git/config", ".GIT/config", ".situate/state",
    "Notes/.SiTuAtE/state", "alias/state", "Notes/link", "missing", "Notes",
] {
    expectFailure { _ = try content.read(path, maxBytes: 100) }
}
for path in ["/", "..", ".situate", ".GIT", ".situate-write-pending", "alias", "Notes/note.md"] {
    expectFailure { _ = try content.list(path) }
}
for limit in [0, 3, 16 * 1024 * 1024 + 1] {
    expectFailure { _ = try content.read("Notes/note.md", maxBytes: limit) }
}
let empty = root.appendingPathComponent("empty.md")
try Data().write(to: empty)
let emptySnapshot = try content.read("empty.md", maxBytes: 1)
precondition(emptySnapshot.bytes.isEmpty)
let fifo = root.appendingPathComponent("pipe")
precondition(mkfifo(fifo.path, 0o600) == 0)
expectFailure { _ = try content.read("pipe", maxBytes: 10) }

for name in ["existing.", "existing ", "line\nname", "Unicode-\u{03bb}-\u{00e9}-\u{1f331}.md"] {
    let bytes = Data(name.utf8)
    try bytes.write(to: root.appendingPathComponent(name))
    let read = try content.read(name, maxBytes: 100)
    precondition(read.bytes == bytes)
    let listing = try content.list()
    precondition(listing.contains(WorkspaceContentEntry(name: name, directory: false)))
}

let draft = Data("pending draft".utf8)
expectFailure { try content.replace("Notes/note.md", expected: snapshot, draft: draft) }
let retained = try Data(contentsOf: note)
precondition(
    retained == original && snapshot.bytes == original && draft == Data("pending draft".utf8))
try Data("external edit".utf8).write(to: note)
expectFailure { try content.replace("Notes/note.md", expected: snapshot, draft: draft) }
let changed = try Data(contentsOf: note)
precondition(changed == Data("external edit".utf8))
try files.removeItem(at: note)
expectFailure { try content.replace("Notes/note.md", expected: snapshot, draft: draft) }
precondition(!files.fileExists(atPath: note.path))
expectFailure {
    _ = try WorkspaceContent(
        root: URL(string: "https://example.invalid/workspace")!, access: .appLocal)
}

var starts = 0
var stops = 0
var granted = false
let scope = WorkspaceSecurityScope(
    start: { url in
        precondition(url == root)
        starts += 1
        return granted
    },
    stop: { url in
        precondition(url == root)
        stops += 1
    })
let scoped = try WorkspaceContent(root: root, access: .securityScoped, scope: scope)
precondition(scoped.replacementCapability == .unverifiedProviderReplacement)
expectFailure { _ = try scoped.list() }
expectFailure { _ = try scoped.read("empty.md", maxBytes: 1) }
precondition(starts == 2 && stops == 0)
granted = true
_ = try scoped.list()
precondition(starts == 3 && stops == 1)
_ = try scoped.read("empty.md", maxBytes: 1)
precondition(starts == 4 && stops == 2)
expectFailure { _ = try scoped.read("missing.md", maxBytes: 1) }
precondition(starts == 5 && stops == 3)
expectFailure { _ = try scoped.list(".situate") }
precondition(starts == 5 && stops == 3)
let scopedOriginal = try Data(contentsOf: empty)
precondition(scopedOriginal.isEmpty)
let settings = root.appendingPathComponent(".situate/localization.json")
let settingsBefore = try files.contentsOfDirectory(
    atPath: root.appendingPathComponent(".situate").path)
let missingSettings = try scoped.localization()
precondition(missingSettings == nil)
let settingsAfter = try files.contentsOfDirectory(
    atPath: root.appendingPathComponent(".situate").path)
precondition(settingsBefore == settingsAfter)
let preferences = Data(#"{"version":1,"language":"de","custom":"preserved"}"#.utf8)
try preferences.write(to: settings)
let storedPreferences = try scoped.localization()
precondition(storedPreferences == preferences)
expectFailure { _ = try scoped.read(".situate/localization.json", maxBytes: 65_536) }
try Data(repeating: 65, count: 65_537).write(to: settings)
expectFailure { _ = try scoped.localization() }
try files.removeItem(at: settings)
try files.createSymbolicLink(at: settings, withDestinationURL: empty)
expectFailure { _ = try scoped.localization() }
try files.removeItem(at: settings)
try files.createDirectory(at: settings, withIntermediateDirectories: false)
expectFailure { _ = try scoped.localization() }
try files.removeItem(at: settings)
let appearanceSettings = root.appendingPathComponent(".situate/appearance.json")
let appearanceSettingsBefore = try files.contentsOfDirectory(
    atPath: root.appendingPathComponent(".situate").path)
let missingAppearance = try scoped.appearance()
precondition(missingAppearance == nil)
let appearanceSettingsAfter = try files.contentsOfDirectory(
    atPath: root.appendingPathComponent(".situate").path)
precondition(appearanceSettingsBefore == appearanceSettingsAfter)
let accents = Data(#"{"version":1,"accent":"sky","custom":"preserved"}"#.utf8)
try accents.write(to: appearanceSettings)
let storedAccents = try scoped.appearance()
precondition(storedAccents == accents)
expectFailure { _ = try scoped.read(".situate/appearance.json", maxBytes: 65_536) }
try Data(repeating: 65, count: 65_537).write(to: appearanceSettings)
expectFailure { _ = try scoped.appearance() }
try files.removeItem(at: appearanceSettings)
try files.createSymbolicLink(at: appearanceSettings, withDestinationURL: empty)
expectFailure { _ = try scoped.appearance() }
try files.removeItem(at: appearanceSettings)
try files.createDirectory(at: appearanceSettings, withIntermediateDirectories: false)
expectFailure { _ = try scoped.appearance() }
try files.removeItem(at: appearanceSettings)
let workingMethod = root.appendingPathComponent(".situate/working-method.md")
let beforeMethod = try files.contentsOfDirectory(atPath: root.path)
let missingMethod = try scoped.workingMethod()
precondition(missingMethod == nil)
let afterMethod = try files.contentsOfDirectory(atPath: root.path)
precondition(afterMethod == beforeMethod)
let methodBytes = Data("# Working method\nReview on Friday.".utf8)
try methodBytes.write(to: workingMethod)
let loadedMethod = try scoped.workingMethod()
precondition(loadedMethod == methodBytes)
expectFailure { _ = try scoped.read(".situate/working-method.md", maxBytes: 65_536) }
granted = false
expectFailure { _ = try scoped.workingMethod() }
granted = true
try Data(repeating: 65, count: 65_537).write(to: workingMethod)
expectFailure { _ = try scoped.workingMethod() }
try files.removeItem(at: workingMethod)
try files.createSymbolicLink(at: workingMethod, withDestinationURL: empty)
expectFailure { _ = try scoped.workingMethod() }
try files.removeItem(at: workingMethod)
try files.createDirectory(at: workingMethod, withIntermediateDirectories: false)
expectFailure { _ = try scoped.workingMethod() }
try files.removeItem(at: workingMethod)
let coordination = WorkspaceWriteCoordination()
func beginCoordination(_ url: URL, using manager: WorkspaceWriteCoordination? = nil) throws
    -> String
{
    let ready = DispatchSemaphore(value: 0)
    var result: Result<String, Error>?
    (manager ?? coordination).begin(at: url) { value in
        result = value
        ready.signal()
    }
    precondition(
        ready.wait(timeout: .now() + 5) == .success, "Workspace coordination did not start")
    return try result!.get()
}
let secondRoot = files.temporaryDirectory.appendingPathComponent(
    "workspace-coordination-" + UUID().uuidString, isDirectory: true)
try files.createDirectory(at: secondRoot, withIntermediateDirectories: false)
defer { try? files.removeItem(at: secondRoot) }
let firstToken = try beginCoordination(root)
let secondToken = try beginCoordination(secondRoot)
precondition(firstToken != secondToken)
try coordination.end(firstToken)
try coordination.end(firstToken)
try coordination.end("absent-token")
_ = try content.read("empty.md", maxBytes: 1)
try coordination.end(secondToken)
let reopenedToken = try beginCoordination(root)
try coordination.end(reopenedToken)

let accessorReleased = DispatchSemaphore(value: 0)
let allowPhysicalStop = DispatchSemaphore(value: 0)
let physicallyStopped = DispatchGroup()
physicallyStopped.enter()
let controlled = WorkspaceWriteCoordination(coordinate: { url, accessor in
    accessor(url)
    accessorReleased.signal()
    allowPhysicalStop.wait()
    physicallyStopped.leave()
    return nil
})
let controlledToken = try beginCoordination(root, using: controlled)
let endWaiters = DispatchGroup()
let endStarted = DispatchSemaphore(value: 0)
let endReturned = DispatchSemaphore(value: 0)
for _ in 0..<2 {
    endWaiters.enter()
    DispatchQueue.global().async {
        endStarted.signal()
        do {
            try controlled.end(controlledToken)
        } catch {
            fatalError("Concurrent coordination end failed: \(error)")
        }
        precondition(
            physicallyStopped.wait(timeout: .now()) == .success,
            "Coordination end acknowledged before physical stop")
        endReturned.signal()
        endWaiters.leave()
    }
}
precondition(accessorReleased.wait(timeout: .now() + 5) == .success)
precondition(endStarted.wait(timeout: .now() + 5) == .success)
precondition(endStarted.wait(timeout: .now() + 5) == .success)
precondition(endReturned.wait(timeout: .now() + 0.1) == .timedOut)
allowPhysicalStop.signal()
precondition(endWaiters.wait(timeout: .now() + 5) == .success)
try controlled.end(controlledToken)
var sessionStarts = 0
var sessionStops = 0
var sessionAllowed = false
let sessionScope = WorkspaceSecurityScope(
    start: { _ in
        sessionStarts += 1
        return sessionAllowed
    },
    stop: { _ in sessionStops += 1 })
let sessions = WorkspaceSessionGrants(scope: sessionScope)
expectFailure {
    _ = try sessions.begin(at: root, securityScoped: true) {
        fatalError("Denied scope must not inspect the workspace")
    }
}
precondition(sessionStarts == 1 && sessionStops == 0)
sessionAllowed = true
let grant = try sessions.begin(at: root, securityScoped: true) {
    precondition(sessionStops == 0)
}
let grantedRoot = try sessions.root(for: grant)
precondition(grantedRoot == root)
let preparing = try beginCoordination(grantedRoot)
try coordination.end(preparing)
precondition(sessionStarts == 2 && sessionStops == 0)
let independent = try sessions.begin(at: secondRoot, securityScoped: true) {}
sessions.end(grant)
precondition(sessionStops == 1)
expectFailure { _ = try sessions.root(for: grant) }
let independentRoot = try sessions.root(for: independent)
precondition(independentRoot == secondRoot)
sessions.end(grant)
precondition(sessionStops == 1)
sessions.end(independent)
precondition(sessionStops == 2)
expectFailure {
    _ = try sessions.begin(at: root, securityScoped: true) {
        throw WorkspaceContentError(message: "native.provider.folder.readOnly")
    }
}
precondition(sessionStarts == 4 && sessionStops == 3)
let localGrant = try sessions.begin(at: root, securityScoped: false) {}
sessions.end(localGrant)
precondition(sessionStarts == 4 && sessionStops == 3)
do {
    let abandoned = WorkspaceSessionGrants(scope: sessionScope)
    _ = try abandoned.begin(at: root, securityScoped: true) {}
}
precondition(sessionStarts == 5 && sessionStops == 4)
let pendingSession = try sessions.begin(at: root, securityScoped: true) {}
let pendingRoot = try sessions.retain(pendingSession)
let preparationReady = DispatchSemaphore(value: 0)
let preparationFinished = DispatchSemaphore(value: 0)
var pendingCoordination: String?
coordination.begin(
    at: pendingRoot,
    finished: {
        sessions.end(pendingSession)
        preparationFinished.signal()
    },
    started: { result in
        do {
            pendingCoordination = try result.get()
        } catch {
            fatalError("Preparation coordination failed: \(error)")
        }
        preparationReady.signal()
    })
precondition(preparationReady.wait(timeout: .now() + 5) == .success)
sessions.end(pendingSession)
precondition(sessionStarts == 6 && sessionStops == 4)
try coordination.end(pendingCoordination!)
precondition(preparationFinished.wait(timeout: .now() + 5) == .success)
precondition(sessionStops == 5)

print(
    "Content listing, bounded binary reads, path isolation, session scope lifecycle, independent coordinated access and non-destructive write refusal passed."
)

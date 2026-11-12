import Darwin
import Foundation

func expectFailure(_ operation: () throws -> Void) {
    do {
        try operation()
        fatalError("Expected directory creation to fail")
    } catch {}
}
let files = FileManager.default
let root = files.temporaryDirectory.appendingPathComponent(
    "workspace-directories-" + UUID().uuidString, isDirectory: true)
try files.createDirectory(at: root, withIntermediateDirectories: false)
defer { try? files.removeItem(at: root) }

let garden = try NewWorkspaceDirectory(parentURL: root, name: "Garden")
try garden.initialize()
try garden.requireCurrent()
let contents = try files.contentsOfDirectory(atPath: garden.url.path)
let markerContents = try files.contentsOfDirectory(
    atPath: garden.url.appendingPathComponent(".situate").path)
precondition(contents == [".situate"])
precondition(markerContents == ["workspace.json"])
let originalIdentity = WorkspaceIdentity.admit(at: garden.url)!
precondition(WorkspaceIdentity.admit(at: garden.url) == originalIdentity)
let independent = try NewWorkspaceDirectory(parentURL: root, name: "Independent")
try independent.initialize()
precondition(WorkspaceIdentity.admit(at: independent.url) != originalIdentity)
let copy = root.appendingPathComponent("Copy")
try files.copyItem(at: garden.url, to: copy)
precondition(WorkspaceIdentity.admit(at: copy) == originalIdentity)
let identityFile = copy.appendingPathComponent(".situate/workspace.json")
let privateBytes = Data("private sentinel".utf8)
try privateBytes.write(to: identityFile)
precondition(WorkspaceIdentity.admit(at: copy) == nil)
let preservedIdentity = try Data(contentsOf: identityFile)
precondition(preservedIdentity == privateBytes)
try files.removeItem(at: identityFile)
try files.createSymbolicLink(
    at: identityFile, withDestinationURL: root.appendingPathComponent("outside"))
precondition(WorkspaceIdentity.admit(at: copy) == nil)
precondition(!files.fileExists(atPath: root.appendingPathComponent("outside").path))
expectFailure { _ = try NewWorkspaceDirectory(parentURL: root, name: "Garden") }

for populated in [false, true] {
    let directory = try NewWorkspaceDirectory(parentURL: root, name: "Replacement-\(populated)")
    let moved = root.appendingPathComponent("Moved-\(populated)")
    try files.moveItem(at: directory.url, to: moved)
    try files.createDirectory(at: directory.url, withIntermediateDirectories: false)
    let keep = directory.url.appendingPathComponent("keep")
    if populated { try Data("unchanged".utf8).write(to: keep) }
    expectFailure { try directory.initialize() }
    precondition(!files.fileExists(atPath: directory.url.appendingPathComponent(".situate").path))
    precondition(!files.fileExists(atPath: moved.appendingPathComponent(".situate").path))
    if populated {
        let preserved = try String(contentsOf: keep, encoding: .utf8)
        precondition(preserved == "unchanged")
    }
}

let nonempty = try NewWorkspaceDirectory(parentURL: root, name: "Nonempty")
try Data("unchanged".utf8).write(to: nonempty.url.appendingPathComponent("keep"))
expectFailure { try nonempty.initialize() }
precondition(!files.fileExists(atPath: nonempty.url.appendingPathComponent(".situate").path))
let link = root.appendingPathComponent("Link")
try files.createSymbolicLink(at: link, withDestinationURL: nonempty.url)
expectFailure { _ = try DirectoryHandle(at: link.path) }

let parent = root.appendingPathComponent("Parent")
try files.createDirectory(at: parent, withIntermediateDirectories: false)
let directory = try NewWorkspaceDirectory(parentURL: parent, name: "Child")
let movedParent = root.appendingPathComponent("Moved-parent")
try files.moveItem(at: parent, to: movedParent)
try files.createDirectory(at: parent, withIntermediateDirectories: false)
expectFailure { try directory.initialize() }
precondition(!files.fileExists(atPath: movedParent.appendingPathComponent("Child/.situate").path))
try files.removeItem(at: parent)
try files.moveItem(at: movedParent, to: parent)
try directory.initialize()
try files.moveItem(at: directory.url, to: parent.appendingPathComponent("Moved-child"))
try files.createDirectory(at: directory.url, withIntermediateDirectories: false)
expectFailure { try directory.requireCurrent() }
precondition(!files.fileExists(atPath: directory.url.appendingPathComponent(".situate").path))
let legacy = root.appendingPathComponent("Legacy")
try files.createDirectory(
    at: legacy.appendingPathComponent(".situate"), withIntermediateDirectories: true)
let identityLock = NSLock()
var identities = [String?]()
DispatchQueue.concurrentPerform(iterations: 16) { _ in
    let identity = WorkspaceIdentity.admit(at: legacy)
    identityLock.lock()
    identities.append(identity)
    identityLock.unlock()
}
precondition(identities.count == 16 && identities[0] != nil)
precondition(identities.allSatisfy { $0 == identities[0] })
let readOnly = root.appendingPathComponent("ReadOnly")
let readOnlyMarker = readOnly.appendingPathComponent(".situate")
try files.createDirectory(at: readOnlyMarker, withIntermediateDirectories: true)
precondition(chmod(readOnlyMarker.path, 0o500) == 0)
precondition(WorkspaceIdentity.admit(at: readOnly) == nil)
precondition(chmod(readOnlyMarker.path, 0o700) == 0)
precondition(
    !files.fileExists(atPath: readOnlyMarker.appendingPathComponent("workspace.json").path))
for text in [
    "private sentinel", String(repeating: " ", count: 1025),
    "{\"version\":2,\"id\":\"1d44dd21-3194-42cc-bb00-a2a8e77456ca\"}",
    "{\"version\":1,\"id\":\"1d44dd21-3194-42cc-bb00-a2a8e77456ca\",\"device\":\"private sentinel\"}",
] {
    precondition(WorkspaceIdentity.validate(Data(text.utf8)) == nil)
}
print("Directory creation, collision, replacement, no-follow and identity checks passed.")

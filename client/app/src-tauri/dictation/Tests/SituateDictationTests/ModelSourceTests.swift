import Foundation
import Testing

@testable import SituateDictation

private let fixtureFile = ModelFile(
    path: "weights/model.bin", size: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

private func withModelSourceFixture(_ test: (URL, URL) async throws -> Void) async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("shared source")
    let artifact = source.appendingPathComponent(ModelManifest.revision)
        .appendingPathComponent(fixtureFile.path)
    try FileManager.default.createDirectory(
        at: artifact.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("abc".utf8).write(to: artifact)
    try await test(root, source)
}

@Test func localModelSourceCopiesIntoIndependentWorktreesWithoutNetwork() async throws {
    try await withModelSourceFixture { root, source in
        let modelSource = ModelSource.local(source)
        #expect(!modelSource.requiresNetwork)
        for name in ["first tree", "second tree"] {
            let destination = root.appendingPathComponent(name)
                .appendingPathComponent(fixtureFile.path)
            try await modelSource.provision(
                fixtureFile, to: destination, networkAvailable: false
            ) { bytes in #expect(bytes == 3) }
            #expect(try Data(contentsOf: destination) == Data("abc".utf8))
            #expect(
                !FileManager.default.fileExists(
                    atPath: destination.appendingPathExtension("partial").path))
        }
        try Data("changed".utf8).write(
            to: root.appendingPathComponent("first tree").appendingPathComponent(fixtureFile.path))
        #expect(
            try Data(
                contentsOf: source.appendingPathComponent(ModelManifest.revision)
                    .appendingPathComponent(fixtureFile.path)) == Data("abc".utf8))
        #expect(
            try Data(
                contentsOf: root.appendingPathComponent("second tree")
                    .appendingPathComponent(fixtureFile.path)) == Data("abc".utf8))
    }
}

@Test func verifiedModelsAreReusedEvenWhenTheirSourceIsUnavailable() async throws {
    try await withModelSourceFixture { root, source in
        let destination = root.appendingPathComponent("installed/model.bin")
        let local = ModelSource.local(source)
        try await local.provision(fixtureFile, to: destination, networkAvailable: false) { _ in }
        try FileManager.default.removeItem(at: source)
        for modelSource in [local, .huggingFace] {
            try await modelSource.provision(
                fixtureFile, to: destination, networkAvailable: false
            ) { _ in Issue.record("Verified files must not be provisioned again") }
            #expect(try Data(contentsOf: destination) == Data("abc".utf8))
        }
    }
}

@Test func missingLocalFilesFailInsteadOfFallingBackToDownloads() async throws {
    try await withModelSourceFixture { root, source in
        try FileManager.default.removeItem(at: source)
        for networkAvailable in [false, true] {
            let destination = root.appendingPathComponent("installed/model.bin")
            do {
                try await ModelSource.local(source).provision(
                    fixtureFile, to: destination, networkAvailable: networkAvailable
                ) { _ in Issue.record("Missing files must not report progress") }
                Issue.record("A missing local source must fail")
            } catch {
                #expect((error as NSError).domain == NSCocoaErrorDomain)
                #expect((error as NSError).code == NSFileReadNoSuchFileError)
            }
            #expect(!FileManager.default.fileExists(atPath: destination.path))
        }
    }
}

@Test func corruptLocalFilesNeverReplaceInstalledFilesAndCanBeRetried() async throws {
    try await withModelSourceFixture { root, source in
        let artifact = source.appendingPathComponent(ModelManifest.revision)
            .appendingPathComponent(fixtureFile.path)
        let destination = root.appendingPathComponent("installed/model.bin")
        let staging = destination.appendingPathExtension("partial")
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("old".utf8).write(to: destination)
        try Data("interrupted".utf8).write(to: staging)
        try Data("abd".utf8).write(to: artifact)
        let modelSource = ModelSource.local(source)
        do {
            try await modelSource.provision(
                fixtureFile, to: destination, networkAvailable: false
            ) { _ in }
            Issue.record("A corrupt local file must fail verification")
        } catch {
            #expect((error as NSError).code == NSURLErrorCannotDecodeContentData)
        }
        #expect(try Data(contentsOf: destination) == Data("old".utf8))
        #expect(!FileManager.default.fileExists(atPath: staging.path))
        #expect(try Data(contentsOf: artifact) == Data("abd".utf8))
        try Data("abc".utf8).write(to: artifact)
        try await modelSource.provision(
            fixtureFile, to: destination, networkAvailable: false
        ) { _ in }
        #expect(try Data(contentsOf: destination) == Data("abc".utf8))
    }
}

@Test func remoteModelSourceRequiresNetworkForMissingFiles() async throws {
    try await withModelSourceFixture { root, _ in
        #expect(ModelSource.huggingFace.requiresNetwork)
        let destination = root.appendingPathComponent("installed/model.bin")
        do {
            try await ModelSource.huggingFace.provision(
                fixtureFile, to: destination, networkAvailable: false
            ) { _ in Issue.record("Offline downloads must not report progress") }
            Issue.record("A missing remote model must wait for the network")
        } catch {
            #expect((error as NSError).code == NSURLErrorNotConnectedToInternet)
        }
        #expect(!FileManager.default.fileExists(atPath: destination.path))
    }
}

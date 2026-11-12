import Foundation
import Testing

@testable import SituateDictation

@Test func storageFailuresDistinguishDiskFullFromOtherWriteErrors() {
    #expect(isStorageFailure(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)))
    let diskFull = NSError(domain: NSPOSIXErrorDomain, code: Int(POSIXErrorCode.ENOSPC.rawValue))
    #expect(
        isStorageFailure(
            NSError(
                domain: NSURLErrorDomain, code: NSURLErrorCannotWriteToFile,
                userInfo: [NSUnderlyingErrorKey: diskFull])))
    #expect(
        !isStorageFailure(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)))
}

@Test func validatesContentNotJustLength() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("model")
    let file = ModelFile(
        path: "model", size: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    #expect(try !verified(url, file: file))
    try Data("abc".utf8).write(to: url)
    #expect(try verified(url, file: file))
    try Data("abd".utf8).write(to: url)
    #expect(try !verified(url, file: file))
    try Data("ab".utf8).write(to: url)
    #expect(try !verified(url, file: file))
}

@Test func manifestContainsOnlyFixedLocalModelData() {
    #expect(ModelManifest.revision == "7dd20fe6b1797d35f5e3307e8b1732d9a178edfe")
    #expect(Set(ModelManifest.files.map(\.path)).count == ModelManifest.files.count)
    #expect(
        ModelManifest.files.allSatisfy {
            !$0.path.contains("..") && $0.sha256.count == 64 && $0.size > 0
        })
    #expect(
        Set(ModelManifest.files.map { $0.path.split(separator: "/")[0] }) == [
            "Encoder.mlmodelc", "Decoder.mlmodelc", "JointDecisionv3.mlmodelc",
            "Preprocessor.mlmodelc", "parakeet_vocab.json",
        ])
}

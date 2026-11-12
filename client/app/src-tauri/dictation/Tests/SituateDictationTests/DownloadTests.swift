import Foundation
import Testing

@testable import SituateDictation

private final class Transport: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var respond: @Sendable (Transport) -> Void = { _ in }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.respond(self) }
    override func stopLoading() {}
    func response(_ status: Int, _ text: String, range: String? = nil) {
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: range.map { ["Content-Range": $0] })!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(text.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@Suite(.serialized)
struct DownloadTests {
    private func run(_ destination: URL) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Transport.self]
        let file = ModelFile(path: "fixture.bin", size: 6, sha256: "unused")
        try await ModelDownload(
            destination: destination, file: file, configuration: config, progress: { _ in }
        ).run()
        #expect(!config.allowsCellularAccess)
        #expect(config.allowsExpensiveNetworkAccess)
        #expect(config.allowsConstrainedNetworkAccess)
    }

    @Test func resumesOnlyThePinnedArtifactAfterTruncatedTransfer() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("model.partial")
        Transport.respond = { transport in
            #expect(transport.request.url!.path.contains(ModelManifest.revision))
            #expect(transport.request.value(forHTTPHeaderField: "Range") == nil)
            transport.response(200, "abc")
        }
        do {
            try await run(destination)
            Issue.record("A truncated transfer must fail")
        } catch {}
        #expect(try Data(contentsOf: destination) == Data("abc".utf8))
        Transport.respond = { transport in
            #expect(transport.request.value(forHTTPHeaderField: "Range") == "bytes=3-")
            transport.response(206, "def", range: "bytes 3-5/6")
        }
        try await run(destination)
        #expect(try Data(contentsOf: destination) == Data("abcdef".utf8))
    }

    @Test func fullResponseReplacesPartialDataAndInvalidRangeNeverAppends() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("model.partial")
        try Data("abc".utf8).write(to: destination)
        Transport.respond = { $0.response(206, "xyz", range: "bytes 2-4/6") }
        do {
            try await run(destination)
            Issue.record("A mismatched range must fail")
        } catch {}
        #expect(try Data(contentsOf: destination) == Data("abc".utf8))
        Transport.respond = { $0.response(200, "XYZ123") }
        try await run(destination)
        #expect(try Data(contentsOf: destination) == Data("XYZ123".utf8))
    }
}

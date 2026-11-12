import CryptoKit
import Foundation

func verified(_ url: URL, file: ModelFile) throws -> Bool {
    guard FileManager.default.fileExists(atPath: url.path) else { return false }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    guard try handle.seekToEnd() == file.size else { return false }
    try handle.seek(toOffset: 0)
    var hash = SHA256()
    while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
        hash.update(data: data)
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined() == file.sha256
}

final class ModelDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let configuration: URLSessionConfiguration
    private let destination: URL
    private let file: ModelFile
    private let progress: @Sendable (Int64) -> Void
    private var handle: FileHandle?
    private var received: Int64 = 0
    private var continuation: CheckedContinuation<Void, Error>?
    private var session: URLSession?
    private var cancelled = false
    private let queue = OperationQueue()

    init(
        destination: URL, file: ModelFile, configuration: URLSessionConfiguration = .ephemeral,
        progress: @escaping @Sendable (Int64) -> Void
    ) {
        self.configuration = configuration
        self.destination = destination
        self.file = file
        self.progress = progress
        queue.maxConcurrentOperationCount = 1
    }

    func run() async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.addOperation {
                    self.continuation = continuation
                    if self.cancelled {
                        self.finish(CancellationError())
                        return
                    }
                    do {
                        let fm = FileManager.default
                        try fm.createDirectory(
                            at: self.destination.deletingLastPathComponent(),
                            withIntermediateDirectories: true)
                        if !fm.fileExists(atPath: self.destination.path) {
                            fm.createFile(
                                atPath: self.destination.path, contents: nil,
                                attributes: [.posixPermissions: 0o600])
                        }
                        let handle = try FileHandle(forWritingTo: self.destination)
                        self.handle = handle
                        self.received = Int64(try handle.seekToEnd())
                        if self.received >= self.file.size {
                            try handle.truncate(atOffset: 0)
                            self.received = 0
                        }
                        let base =
                            "https://huggingface.co/\(ModelManifest.repository)/resolve/\(ModelManifest.revision)/"
                        var request = URLRequest(url: URL(string: base + self.file.path)!)
                        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
                        if self.received > 0 {
                            request.setValue("bytes=\(self.received)-", forHTTPHeaderField: "Range")
                        }
                        let config = self.configuration
                        config.allowsCellularAccess = false
                        config.allowsExpensiveNetworkAccess = true
                        config.allowsConstrainedNetworkAccess = true
                        config.urlCache = nil
                        let session = URLSession(
                            configuration: config, delegate: self, delegateQueue: self.queue)
                        self.session = session
                        session.dataTask(with: request).resume()
                    } catch { self.finish(error) }
                }
            }
        } onCancel: {
            self.queue.addOperation {
                self.cancelled = true
                self.session?.invalidateAndCancel()
            }
        }
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        do {
            if response.statusCode == 200 {
                try handle?.truncate(atOffset: 0)
                try handle?.seek(toOffset: 0)
                received = 0
            } else if response.statusCode != 206
                || response.value(forHTTPHeaderField: "Content-Range")
                    != "bytes \(received)-\(file.size - 1)/\(file.size)"
            {
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
        } catch {
            finish(error)
            completionHandler(.cancel)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do {
            guard received + Int64(data.count) <= file.size else {
                throw URLError(.badServerResponse)
            }
            try handle?.write(contentsOf: data)
            received += Int64(data.count)
            progress(received)
        } catch {
            session.invalidateAndCancel()
            finish(error)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?)
    {
        finish(error ?? (received == file.size ? nil : URLError(.badServerResponse)))
    }

    private func finish(_ error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        do {
            try handle?.synchronize()
            try handle?.close()
        } catch {
            self.session?.invalidateAndCancel()
            self.session = nil
            continuation.resume(throwing: error)
            return
        }
        handle = nil
        session?.finishTasksAndInvalidate()
        session = nil
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }
}

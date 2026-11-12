import Foundation

enum ModelSource: Sendable {
    case huggingFace
    case local(URL)

    var requiresNetwork: Bool {
        if case .huggingFace = self { return true }
        return false
    }

    func provision(
        _ file: ModelFile, to destination: URL, networkAvailable: Bool,
        progress: @escaping @Sendable (Int64) -> Void
    ) async throws {
        try Task.checkCancellation()
        if try verified(destination, file: file) { return }
        let staging = destination.appendingPathExtension("partial")
        let fm = FileManager.default
        switch self {
        case .huggingFace:
            guard networkAvailable else { throw URLError(.notConnectedToInternet) }
            try await ModelDownload(destination: staging, file: file, progress: progress).run()
        case .local(let root):
            let source = root.appendingPathComponent(ModelManifest.revision)
                .appendingPathComponent(file.path)
            try fm.createDirectory(
                at: staging.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fm.fileExists(atPath: staging.path) { try fm.removeItem(at: staging) }
            try fm.copyItem(at: source, to: staging)
            progress(file.size)
        }
        guard try verified(staging, file: file) else {
            try fm.removeItem(at: staging)
            throw URLError(.cannotDecodeContentData)
        }
        try Task.checkCancellation()
        if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
        try fm.moveItem(at: staging, to: destination)
    }
}

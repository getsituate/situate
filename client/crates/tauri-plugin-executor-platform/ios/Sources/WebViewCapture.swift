import Foundation
import UIKit
import WebKit

struct SnapshotRect: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    func validated(in bounds: CGRect) throws -> CGRect {
        guard [x, y, width, height].allSatisfy({ $0.isFinite }),
            x >= 0, y >= 0, width > 0, height > 0
        else { throw SnapshotFailure.invalid }
        guard width <= 2048, height <= 2048, ceil(width) * ceil(height) <= 4_000_000 else {
            throw SnapshotFailure.limit
        }
        guard
            [bounds.origin.x, bounds.origin.y, bounds.width, bounds.height].allSatisfy({
                $0.isFinite
            }),
            bounds.width > 0, bounds.height > 0,
            x >= bounds.minX, y >= bounds.minY,
            width <= bounds.width, height <= bounds.height,
            x - bounds.minX <= bounds.width - width,
            y - bounds.minY <= bounds.height - height
        else { throw SnapshotFailure.invalid }
        return CGRect(x: x, y: y, width: width, height: height)
    }
}

enum SnapshotFailure: Error {
    case invalid, limit, unavailable

    var key: String {
        switch self {
        case .invalid: return "native.plugins.checkInvalid"
        case .limit: return "native.plugins.checkLimit"
        case .unavailable: return "native.plugins.captureUnavailable"
        }
    }
}

func captureWebView(
    _ view: WKWebView?, rect: SnapshotRect,
    isCurrent: @escaping () -> Bool = { true },
    completion: @escaping (Result<String, SnapshotFailure>) -> Void
) {
    guard isCurrent(), let view = view else {
        completion(.failure(.unavailable))
        return
    }
    let region: CGRect
    do { region = try rect.validated(in: view.bounds) } catch let error as SnapshotFailure {
        completion(.failure(error))
        return
    } catch {
        completion(.failure(.invalid))
        return
    }

    let configuration = WKSnapshotConfiguration()
    configuration.rect = region
    configuration.afterScreenUpdates = true
    configuration.snapshotWidth = NSNumber(value: rect.width)
    let deadline = ProcessInfo.processInfo.systemUptime + 5
    var finished = false
    let complete: (Result<String, SnapshotFailure>) -> Void = { result in
        guard !finished else { return }
        finished = true
        completion(result)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { complete(.failure(.unavailable)) }
    view.takeSnapshot(with: configuration) { image, error in
        guard !finished else { return }
        guard isCurrent(), ProcessInfo.processInfo.systemUptime < deadline else {
            complete(.failure(.unavailable))
            return
        }
        guard error == nil, let data = image?.pngData(), !data.isEmpty else {
            complete(.failure(.unavailable))
            return
        }
        guard ((data.count + 2) / 3) * 4 <= 24 * 1024 * 1024 else {
            complete(.failure(.limit))
            return
        }
        complete(.success(data.base64EncodedString()))
    }
}

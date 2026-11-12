import UIKit
import WebKit
import XCTest

@testable import ExecutorHarness

private final class SnapshotNavigation: NSObject, WKNavigationDelegate {
    let loaded: () -> Void
    init(loaded: @escaping () -> Void) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded() }
}

@MainActor
final class SnapshotTests: XCTestCase {
    func testRectangleAdmissionRejectsInvalidOversizedAndClippedRegions() throws {
        let bounds = CGRect(x: 0, y: 0, width: 4096, height: 4096)
        for rect in [
            SnapshotRect(x: .nan, y: 0, width: 1, height: 1),
            SnapshotRect(x: 0, y: .infinity, width: 1, height: 1),
            SnapshotRect(x: -1, y: 0, width: 1, height: 1),
            SnapshotRect(x: 0, y: -1, width: 1, height: 1),
            SnapshotRect(x: 0, y: 0, width: 0, height: 1),
            SnapshotRect(x: 0, y: 0, width: 1, height: 0),
            SnapshotRect(x: 4090, y: 0, width: 10, height: 10),
        ] {
            XCTAssertThrowsError(try rect.validated(in: bounds)) { error in
                XCTAssertEqual((error as? SnapshotFailure)?.key, "native.plugins.checkInvalid")
            }
        }
        for rect in [
            SnapshotRect(x: 0, y: 0, width: 2048.01, height: 1),
            SnapshotRect(x: 0, y: 0, width: 1, height: 2048.01),
            SnapshotRect(x: 0, y: 0, width: 2048, height: 2048),
            SnapshotRect(x: 0, y: 0, width: 2000.01, height: 2000),
        ] {
            XCTAssertThrowsError(try rect.validated(in: bounds)) { error in
                XCTAssertEqual((error as? SnapshotFailure)?.key, "native.plugins.checkLimit")
            }
        }
        XCTAssertEqual(
            try SnapshotRect(x: 2096, y: 2096, width: 2000, height: 2000).validated(in: bounds),
            CGRect(x: 2096, y: 2096, width: 2000, height: 2000))
    }

    func testMissingViewFailsWithoutFallback() {
        var observed: String?
        captureWebView(nil, rect: SnapshotRect(x: 0, y: 0, width: 1, height: 1)) { result in
            if case .failure(let error) = result { observed = error.key }
        }
        XCTAssertEqual(observed, "native.plugins.captureUnavailable")
    }

    func testDetachedPreviewSnapshotAndClosure() throws {
        let loaded = expectation(description: "detached preview rendered")
        let executor = ExecutorWebView(
            html: """
                <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline'">
                <body style="margin:0;background:#0000ff">
                <script>window.onload = () => window.webkit.messageHandlers.executor.postMessage({kind:'painted'})</script>
                """, preview: true
        ) { event in
            if event["kind"] as? String == "painted" { loaded.fulfill() }
        }
        defer { executor.close() }
        let view = try XCTUnwrap(executor.webView)
        XCTAssertEqual(view.bounds.size, CGSize(width: 1024, height: 768))
        XCTAssertNil(view.superview)
        XCTAssertNil(view.window)
        XCTAssertFalse(view.isUserInteractionEnabled)
        wait(for: [loaded], timeout: 10)
        let captured = expectation(description: "detached preview PNG")
        var png: String?
        executor.capture(rect: SnapshotRect(x: 10, y: 10, width: 40, height: 60)) { result in
            switch result {
            case .success(let value): png = value
            case .failure(let error): XCTFail(error.key)
            }
            captured.fulfill()
        }
        wait(for: [captured], timeout: 7)
        let data = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(png)))
        let image = try XCTUnwrap(UIImage(data: data)?.cgImage)
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue))
        context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        let pixel = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        XCTAssertLessThan(pixel[0], 10)
        XCTAssertLessThan(pixel[1], 10)
        XCTAssertGreaterThan(pixel[2], 245)
        XCTAssertEqual(pixel[3], 255)
        XCTAssertNil(view.superview)
        XCTAssertNil(view.window)
        executor.close()
        XCTAssertNil(executor.webView)
        let closed = expectation(description: "closed capture rejected")
        executor.capture(rect: SnapshotRect(x: 0, y: 0, width: 1, height: 1)) { result in
            if case .failure(let error) = result {
                XCTAssertEqual(error.key, "native.plugins.captureUnavailable")
            } else {
                XCTFail("closed capture succeeded")
            }
            closed.fulfill()
        }
        wait(for: [closed], timeout: 1)
    }

    func testClosingPreviewFencesPendingSnapshot() throws {
        let executor = ExecutorWebView(html: "<body></body>", preview: true) { _ in }
        let completed = expectation(description: "snapshot fenced by close")
        executor.capture(rect: SnapshotRect(x: 0, y: 0, width: 10, height: 10)) { result in
            if case .success = result { XCTFail("snapshot returned after close") }
            completed.fulfill()
        }
        executor.close()
        wait(for: [completed], timeout: 7)
    }

    func testNativeSnapshotContainsOnlyTheRequestedSyntheticRegion() throws {
        let window = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }.first { $0.isKeyWindow })
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(
            frame: CGRect(x: 0, y: 0, width: 160, height: 80), configuration: configuration)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        window.addSubview(view)
        defer {
            view.navigationDelegate = nil
            view.removeFromSuperview()
        }
        let loaded = expectation(description: "synthetic region rendered")
        let navigation = SnapshotNavigation { loaded.fulfill() }
        view.navigationDelegate = navigation
        view.loadHTMLString(
            """
            <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'">
            <body style="margin:0;background:#ff0000">
            <div style="position:absolute;left:80px;top:0;width:80px;height:80px;background:#0000ff"></div>
            """, baseURL: URL(string: "https://snapshot.invalid/"))
        wait(for: [loaded], timeout: 10)
        let captured = expectation(description: "bounded PNG captured")
        var png: String?
        captureWebView(view, rect: SnapshotRect(x: 100, y: 10, width: 40, height: 60)) { result in
            switch result {
            case .success(let value): png = value
            case .failure(let error): XCTFail(error.key)
            }
            captured.fulfill()
        }
        wait(for: [captured], timeout: 7)
        let data = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(png)))
        XCTAssertEqual(Array(data.prefix(8)), [137, 80, 78, 71, 13, 10, 26, 10])
        let image = try XCTUnwrap(UIImage(data: data))
        XCTAssertEqual(image.size.width / image.size.height, 2.0 / 3.0, accuracy: 0.001)
        let cgImage = try XCTUnwrap(image.cgImage)
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        let pixel = try XCTUnwrap(context.data).assumingMemoryBound(to: UInt8.self)
        XCTAssertLessThan(pixel[0], 10)
        XCTAssertLessThan(pixel[1], 10)
        XCTAssertGreaterThan(pixel[2], 245)
        XCTAssertEqual(pixel[3], 255)
    }
}

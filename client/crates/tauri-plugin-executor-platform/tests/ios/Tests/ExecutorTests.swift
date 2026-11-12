import WebKit
import XCTest

@testable import ExecutorHarness

@MainActor
final class ExecutorTests: XCTestCase {
    func testOffscreenModuleWorkerCSPAndNativeTeardown() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "executor", withExtension: "html"))
        let html = try String(contentsOf: url, encoding: .utf8)
        let ready = expectation(description: "supervisor loaded")
        var observer: ([String: Any]) -> Void = { event in
            if event["kind"] as? String == "ready" { ready.fulfill() }
        }
        let executor = ExecutorWebView(html: html) { observer($0) }
        XCTAssertEqual(executor.webView?.frame, CGRect.zero)
        XCTAssertEqual(executor.webView?.isUserInteractionEnabled, true)
        XCTAssertNil(executor.webView?.window)
        defer { executor.close() }
        wait(for: [ready], timeout: 15)
        XCTAssertNil(executor.webView?.superview)

        let worker = expectation(description: "module Worker import and CSP")
        observer = { event in
            guard let payload = event["payload"] as? [String: Any],
                let result = payload["worker"] as? [String: Any]
            else { return }
            XCTAssertEqual(result["value"] as? Int, 42)
            XCTAssertEqual(result["network"] as? String, "blocked")
            XCTAssertEqual(result["generated"] as? Int, 42)
            worker.fulfill()
        }
        executor.send(script: "globalThis.__situateReceive('worker')") { XCTAssertTrue($0) }
        wait(for: [worker], timeout: 15)

        let stopped = expectation(description: "supervisor stops synchronous Worker loop")
        observer = { event in
            if (event["payload"] as? [String: Any])?["stopped"] as? Bool == true {
                stopped.fulfill()
            }
        }
        executor.send(script: "globalThis.__situateReceive('stop')") { XCTAssertTrue($0) }
        wait(for: [stopped], timeout: 5)

        let network = expectation(description: "supervisor cannot fetch")
        observer = { event in
            if let result = (event["payload"] as? [String: Any])?["network"] as? String {
                XCTAssertEqual(result, "blocked")
                network.fulfill()
            }
        }
        executor.send(script: "globalThis.__situateReceive('network')") { XCTAssertTrue($0) }
        wait(for: [network], timeout: 5)
        executor.close()
        XCTAssertNil(executor.webView)
        var delivered = true
        executor.send(script: "throw 1") { delivered = $0 }
        XCTAssertFalse(delivered)
    }

    func testNavigationRevokesAndReleasesNativeView() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "executor", withExtension: "html"))
        let ready = expectation(description: "supervisor loaded")
        let lost = expectation(description: "navigation lost")
        let executor = ExecutorWebView(html: try String(contentsOf: url)) { event in
            if event["kind"] as? String == "ready" { ready.fulfill() }
            if event["kind"] as? String == "lost" {
                XCTAssertEqual(event["reason"] as? String, "navigation")
                lost.fulfill()
            }
        }
        defer { executor.close() }
        wait(for: [ready], timeout: 15)
        executor.send(script: "location.href='https://executor.invalid/blocked-navigation'") { _ in
        }
        wait(for: [lost], timeout: 5)
        XCTAssertNil(executor.webView)
    }
}

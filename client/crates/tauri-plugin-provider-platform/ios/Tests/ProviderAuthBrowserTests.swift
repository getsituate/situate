import AuthenticationServices
import UIKit
import XCTest

@testable import ProviderPlatform

private final class FakeAuthenticationSession: ProviderAuthenticationSession {
    var presentationContextProvider: (any ASWebAuthenticationPresentationContextProviding)?
    var starts = true
    var cancellations = 0
    let completion: (Error?) -> Void
    init(completion: @escaping (Error?) -> Void) { self.completion = completion }
    func start() -> Bool { starts }
    func cancel() {
        cancellations += 1
        completion(
            NSError(
                domain: ASWebAuthenticationSessionErrorDomain,
                code: ASWebAuthenticationSessionError.Code.canceledLogin.rawValue))
    }
}

@MainActor
final class ProviderAuthBrowserTests: XCTestCase {
    private let url = URL(string: "https://auth.openai.com/api/accounts/authorize?state=synthetic")!
    private func drainCallbacks() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async { continuation.resume() }
        }
    }

    func testBusyAndStaleFinishCannotReplaceOrCloseAnotherAttempt() async throws {
        var sessions: [FakeAuthenticationSession] = []
        var events: [ProviderAuthExit] = []
        let browser = ProviderAuthBrowser(
            makeSession: { _, completion in
                let session = FakeAuthenticationSession(completion: completion)
                sessions.append(session)
                return session
            }, isForeground: { _ in true })
        let window = UIWindow()
        try browser.start(url: url, attemptID: "first", window: window) { events.append($0) }
        XCTAssertThrowsError(
            try browser.start(url: url, attemptID: "second", window: window) { events.append($0) }
        ) { error in
            XCTAssertEqual(error as? ProviderBrowserError, .busy)
        }
        XCTAssertEqual(sessions.count, 1)
        browser.finish(attemptID: "stale")
        XCTAssertEqual(sessions[0].cancellations, 0)
        browser.finish(attemptID: "first")
        browser.finish(attemptID: "first")
        XCTAssertEqual(sessions[0].cancellations, 1)
        try browser.start(url: url, attemptID: "second", window: window) { events.append($0) }
        await drainCallbacks()
        XCTAssertTrue(events.isEmpty)
        browser.finish(attemptID: "first")
        XCTAssertEqual(sessions[1].cancellations, 0)
        sessions[1].completion(
            NSError(
                domain: ASWebAuthenticationSessionErrorDomain,
                code: ASWebAuthenticationSessionError.Code.canceledLogin.rawValue))
        await drainCallbacks()
        XCTAssertEqual(events, [.cancelled])
    }

    func testNativeCompletionNeverSignalsProviderSuccess() async throws {
        var completion: ((Error?) -> Void)?
        var events: [ProviderAuthExit] = []
        let browser = ProviderAuthBrowser(
            makeSession: { _, callback in
                completion = callback
                return FakeAuthenticationSession(completion: callback)
            }, isForeground: { _ in true })
        try browser.start(url: url, attemptID: "synthetic", window: UIWindow()) {
            events.append($0)
        }
        completion?(nil)
        await drainCallbacks()
        XCTAssertEqual(events, [.failed])
    }

    func testFailedStartAndMissingForegroundSceneDoNotLeaveBusyOwnership() throws {
        var starts = false
        let browser = ProviderAuthBrowser(
            makeSession: { _, callback in
                let session = FakeAuthenticationSession(completion: callback)
                session.starts = starts
                return session
            }, isForeground: { _ in true })
        XCTAssertThrowsError(
            try browser.start(url: url, attemptID: "failed", window: UIWindow()) { _ in })
        starts = true
        try browser.start(url: url, attemptID: "next", window: UIWindow()) { _ in }
        browser.finish(attemptID: "next")
        let unavailable = ProviderAuthBrowser(
            makeSession: { _, callback in
                XCTFail("Background scene must not start a session")
                return FakeAuthenticationSession(completion: callback)
            }, isForeground: { _ in false })
        XCTAssertThrowsError(
            try unavailable.start(url: url, attemptID: "background", window: UIWindow()) { _ in })
    }
}

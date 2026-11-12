import AuthenticationServices
import UIKit

protocol ProviderAuthenticationSession: AnyObject {
    var presentationContextProvider: (any ASWebAuthenticationPresentationContextProviding)? {
        get set
    }
    func start() -> Bool
    func cancel()
}

extension ASWebAuthenticationSession: ProviderAuthenticationSession {}

enum ProviderAuthExit: String { case cancelled, failed }
enum ProviderBrowserError: String, Error {
    case busy = "native.ai.browser.busy"
    case failed = "native.ai.browser.openFailed"
}

@MainActor
final class ProviderAuthBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    typealias Factory = @MainActor (URL, @escaping (Error?) -> Void) ->
        any ProviderAuthenticationSession
    typealias ForegroundCheck = @MainActor (UIWindow) -> Bool
    private struct Attempt {
        let id: String
        let session: any ProviderAuthenticationSession
        let window: UIWindow
        let exited: (ProviderAuthExit) -> Void
    }
    private var active: Attempt?
    private let makeSession: Factory
    private let isForeground: ForegroundCheck

    init(
        makeSession: @escaping Factory = { url, completion in
            // HTTP loopback completion belongs to Rust, not a browser callback scheme.
            ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { _, error in
                completion(error)
            }
        },
        isForeground: @escaping ForegroundCheck = { window in
            guard let scene = window.windowScene else { return false }
            return scene.activationState == .foregroundActive
                || scene.activationState == .foregroundInactive
        }
    ) {
        self.makeSession = makeSession
        self.isForeground = isForeground
    }

    func start(
        url: URL, attemptID: String, window: UIWindow, exited: @escaping (ProviderAuthExit) -> Void
    ) throws {
        guard active == nil else { throw ProviderBrowserError.busy }
        guard !attemptID.isEmpty, attemptID.utf8.count <= 128, isForeground(window) else {
            throw ProviderBrowserError.failed
        }
        let session = makeSession(url) { [weak self] error in
            DispatchQueue.main.async { self?.closed(attemptID: attemptID, error: error) }
        }
        session.presentationContextProvider = self
        active = Attempt(id: attemptID, session: session, window: window, exited: exited)
        guard session.start() else {
            active = nil
            throw ProviderBrowserError.failed
        }
    }

    func finish(attemptID: String) {
        guard let attempt = active, attempt.id == attemptID else { return }
        // Mark completion before cancel: its canceledLogin callback must not undo Rust's outcome.
        active = nil
        attempt.session.cancel()
    }

    private func closed(attemptID: String, error: Error?) {
        guard let attempt = active, attempt.id == attemptID else { return }
        active = nil
        let code = (error as? ASWebAuthenticationSessionError)?.code
        attempt.exited(code == .canceledLogin ? .cancelled : .failed)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        active?.window ?? UIWindow()
    }
}

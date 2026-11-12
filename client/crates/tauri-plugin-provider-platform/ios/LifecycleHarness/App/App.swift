import AuthenticationServices
import Security
import UIKit

@_silgen_name("synthetic_start_server") func startServer() -> UInt16
@_silgen_name("synthetic_callback_count") func callbackCount() -> UInt32
@_silgen_name("synthetic_start_count") func startCount() -> UInt32

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication, configurationForConnecting session: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Main", sessionRole: session.role)
        config.delegateClass = AuthScene.self
        return config
    }
}

class AuthScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let browser = ProviderAuthBrowser()
    private var timer: Timer?
    private let status = UILabel()
    private var samples = 0
    private var backgrounds = 0
    private var started = Date()
    private var startupDuration = TimeInterval.zero

    func scene(
        _ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions
    ) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        status.text = "Ready"
        status.accessibilityIdentifier = "status"
        status.numberOfLines = 0
        let start = UIButton(type: .system)
        start.setTitle("Start synthetic sign-in", for: .normal)
        start.accessibilityIdentifier = "start"
        start.addTarget(self, action: #selector(begin), for: .touchUpInside)
        let keychain = UIButton(type: .system)
        keychain.setTitle("Test isolated Keychain", for: .normal)
        keychain.accessibilityIdentifier = "keychain"
        keychain.addTarget(self, action: #selector(testKeychain), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [start, keychain, status])
        stack.axis = .vertical
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),
            stack.widthAnchor.constraint(equalToConstant: 320),
        ])
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { _ in self.backgrounds += 1 }
    }

    @objc private func begin() {
        guard let window else { return }
        let id = UUID().uuidString
        let port = startServer()
        started = Date()
        do {
            try browser.start(
                url: URL(string: "http://127.0.0.1:\(port)/start")!, attemptID: id, window: window
            ) { outcome in
                self.timer?.invalidate()
                self.status.text = outcome == .cancelled ? "Cancelled" : "Failed browser"
            }
            startupDuration = Date().timeIntervalSince(started)
            status.text = "Started"
        } catch {
            status.text = "Start failed"
            return
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            Task { @MainActor in
                if UIApplication.shared.applicationState != .background { self.samples += 1 }
                if callbackCount() > 0 {
                    self.browser.finish(attemptID: id)
                    timer.invalidate()
                    let passed =
                        self.backgrounds == 0 && self.samples > 300
                        && Date().timeIntervalSince(self.started) >= 35 && startCount() > 0
                        && self.startupDuration < 1
                    self.status.text =
                        passed ? "Passed delayed Rust loopback" : "Failed foreground lifecycle"
                }
            }
        }
    }

    @objc private func testKeychain() {
        let account = "synthetic-lifecycle-test:" + UUID().uuidString
        DispatchQueue.global(qos: .userInitiated).async {
            var lastStatus: OSStatus = errSecSuccess
            var store = ProviderKeyStore()
            store.add = { query, output in
                lastStatus = SecItemAdd(query, output)
                return lastStatus
            }
            store.copy = { query, output in
                lastStatus = SecItemCopyMatching(query, output)
                return lastStatus
            }
            var success = false
            do {
                defer { try? store.remove(account) }
                var key = Data(count: 32)
                let random = key.withUnsafeMutableBytes {
                    SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
                }
                guard random == errSecSuccess else { throw ProviderStoreError("failed") }
                try store.set(account, key: key)
                guard try store.get(account) == key else { throw ProviderStoreError("invalid") }
                try store.remove(account)
                do { _ = try store.get(account) } catch let error as ProviderStoreError
                    where error.key == "native.ai.secureStore.missing"
                { success = true }
                try store.remove(account)
            } catch { success = false }
            let result =
                success
                ? "Passed isolated Keychain roundtrip"
                : "Isolated Keychain unavailable: \(lastStatus)"
            DispatchQueue.main.async { self.status.text = result }
        }
    }
}

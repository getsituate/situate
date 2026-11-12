import Foundation
import Tauri
import UIKit

private struct StoreArgs: Decodable {
    let operation: String
    let account: String?
    let key: String?
}
private struct BrowserArgs: Decodable { let url: String }
private struct AuthBrowserArgs: Decodable {
    let url: String
    let attemptId: String
    let events: Channel
}
private struct FinishAuthBrowserArgs: Decodable { let attemptId: String }

class ProviderPlatformPlugin: Plugin {
    private let queue = DispatchQueue(label: "dev.situate.provider-keys")
    @MainActor private var authBrowser: ProviderAuthBrowser?

    @objc public func store(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(StoreArgs.self)
        queue.async {
            do {
                let store = ProviderKeyStore()
                switch args.operation {
                case "availability":
                    try store.availability()
                    invoke.resolve([:])
                case "directory": invoke.resolve(["path": try ProviderKeyStore.directory().path])
                case "get":
                    invoke.resolve(["key": try store.get(args.account ?? "").base64EncodedString()])
                case "set":
                    guard let value = args.key, let data = Data(base64Encoded: value) else {
                        throw ProviderStoreError("invalid")
                    }
                    try store.set(args.account ?? "", key: data)
                    invoke.resolve([:])
                case "delete":
                    try store.remove(args.account ?? "")
                    invoke.resolve([:])
                default: throw ProviderStoreError("invalid")
                }
            } catch let error as ProviderStoreError {
                invoke.reject(error.key)
            } catch { invoke.reject("native.ai.secureStore.failed") }
        }
    }

    @objc public func openAuthBrowser(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AuthBrowserArgs.self)
        guard let url = permittedProviderURL(args.url) else {
            invoke.reject("native.ai.browser.invalidUrl")
            return
        }
        DispatchQueue.main.async {
            guard let window = self.manager.viewController?.view.window else {
                invoke.reject("native.ai.browser.openFailed")
                return
            }
            let browser = self.authBrowser ?? ProviderAuthBrowser()
            self.authBrowser = browser
            do {
                try browser.start(url: url, attemptID: args.attemptId, window: window) { outcome in
                    args.events.send(
                        JsonValue.dictionary([
                            "attemptId": args.attemptId, "kind": outcome.rawValue,
                        ]))
                }
                invoke.resolve([:])
            } catch let error as ProviderBrowserError { invoke.reject(error.rawValue) } catch {
                invoke.reject("native.ai.browser.openFailed")
            }
        }
    }

    @objc public func finishAuthBrowser(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(FinishAuthBrowserArgs.self)
        DispatchQueue.main.async {
            self.authBrowser?.finish(attemptID: args.attemptId)
            invoke.resolve([:])
        }
    }

    @objc public func openBrowser(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(BrowserArgs.self)
        guard let url = permittedProviderURL(args.url) else {
            invoke.reject("native.ai.browser.invalidUrl")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    invoke.resolve([:])
                } else {
                    invoke.reject("native.ai.browser.openFailed")
                }
            }
        }
    }
}

@_cdecl("init_plugin_provider_platform")
public func initPlugin() -> Plugin { ProviderPlatformPlugin() }

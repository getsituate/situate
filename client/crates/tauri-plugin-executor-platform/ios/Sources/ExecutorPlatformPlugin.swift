import Foundation
import Tauri
import UIKit
import WebKit

private struct OpenArgs: Decodable {
    let id: String
    let html: String
    let events: Channel
    let preview: Bool
}
private struct SendArgs: Decodable {
    let id: String
    let script: String
}
private struct CaptureArgs: Decodable {
    let id: String
    let rect: SnapshotRect
}
private struct CloseArgs: Decodable { let id: String }

class ExecutorPlatformPlugin: Plugin {
    private var executors: [String: ExecutorWebView] = [:]
    private var channels: [String: Channel] = [:]
    private var backgroundObserver: NSObjectProtocol?
    private weak var originalWebView: WKWebView?

    override func load(webview: WKWebView) { originalWebView = webview }

    @objc public func capture(_ invoke: Invoke) throws {
        let rect = try invoke.parseArgs(SnapshotRect.self)
        DispatchQueue.main.async {
            captureWebView(self.originalWebView, rect: rect) { result in
                switch result {
                case .success(let png): invoke.resolve(["png": png])
                case .failure(let error): invoke.reject(error.key)
                }
            }
        }
    }

    @objc public func captureExecutor(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CaptureArgs.self)
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        DispatchQueue.main.async {
            guard ProcessInfo.processInfo.systemUptime < deadline,
                let executor = self.executors[args.id]
            else {
                invoke.reject("native.plugins.captureUnavailable")
                return
            }
            executor.capture(rect: args.rect) { result in
                guard ProcessInfo.processInfo.systemUptime < deadline,
                    self.executors[args.id] === executor
                else {
                    invoke.reject("native.plugins.captureUnavailable")
                    return
                }
                switch result {
                case .success(let png): invoke.resolve(["png": png])
                case .failure(let error): invoke.reject(error.key)
                }
            }
        }
    }

    override init() {
        super.init()
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            for id in Array(self.executors.keys) { self.stop(id, reason: "backgrounded") }
        }
    }

    deinit {
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
    }

    @objc public func open(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .background,
                self.executors[args.id] == nil
            else {
                invoke.reject("executor.openFailed")
                return
            }
            self.channels[args.id] = args.events
            self.executors[args.id] = ExecutorWebView(html: args.html, preview: args.preview) {
                [weak owner = self] event in
                guard let self = owner, let channel = self.channels[args.id] else { return }
                if event["kind"] as? String == "lost" {
                    self.executors.removeValue(forKey: args.id)?.close()
                    self.channels.removeValue(forKey: args.id)
                }
                channel.send(JsonValue.dictionary(["id": args.id, "event": event]))
            }
            invoke.resolve([:])
        }
    }

    @objc public func send(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SendArgs.self)
        DispatchQueue.main.async {
            guard let executor = self.executors[args.id] else {
                invoke.reject("executor.closed")
                return
            }
            executor.send(script: args.script) { success in
                if success { invoke.resolve([:]) } else { invoke.reject("executor.sendFailed") }
            }
        }
    }

    @objc public func close(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CloseArgs.self)
        DispatchQueue.main.async {
            self.executors.removeValue(forKey: args.id)?.close()
            self.channels.removeValue(forKey: args.id)
            invoke.resolve([:])
        }
    }

    private func stop(_ id: String, reason: String) {
        executors.removeValue(forKey: id)?.close()
        let channel = channels.removeValue(forKey: id)
        channel?.send(
            JsonValue.dictionary(["id": id, "event": ["kind": "lost", "reason": reason]]))
    }
}

@_cdecl("init_plugin_executor_platform")
public func initPlugin() -> Plugin { ExecutorPlatformPlugin() }

import Foundation
import WebKit

final class ExecutorWebView: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private(set) var webView: WKWebView?
    private var initialNavigation = true
    private var closed = false
    private let event: ([String: Any]) -> Void

    init(html: String, preview: Bool = false, event: @escaping ([String: Any]) -> Void) {
        self.event = event
        super.init()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        if #available(iOS 17.0, *) { configuration.preferences.inactiveSchedulingPolicy = .none }
        configuration.userContentController.add(self, name: "executor")
        let view = WKWebView(
            frame: preview ? CGRect(x: 0, y: 0, width: 1024, height: 768) : .zero,
            configuration: configuration)
        if preview {
            view.isUserInteractionEnabled = false
            view.scrollView.contentInsetAdjustmentBehavior = .never
        }
        webView = view
        view.navigationDelegate = self
        // A tuple origin allows module blob Workers; all network access is denied by the document CSP.
        view.loadHTMLString(html, baseURL: URL(string: "https://executor.invalid/"))
    }

    func send(script: String, completion: @escaping (Bool) -> Void) {
        guard !closed, let view = webView else {
            completion(false)
            return
        }
        view.evaluateJavaScript(script) { _, error in completion(error == nil) }
    }

    func capture(
        rect: SnapshotRect, completion: @escaping (Result<String, SnapshotFailure>) -> Void
    ) {
        captureWebView(
            webView, rect: rect,
            isCurrent: { [weak self, weak view = webView] in
                guard let self = self, let view = view else { return false }
                return !self.closed && self.webView === view
            }, completion: completion)
    }

    func close() {
        guard !closed else { return }
        closed = true
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "executor")
        webView?.navigationDelegate = nil
        webView?.stopLoading()
        webView?.removeFromSuperview()
        webView = nil
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard !closed, message.frameInfo.isMainFrame,
            let body = message.body as? [String: Any],
            JSONSerialization.isValidJSONObject(body),
            let bytes = try? JSONSerialization.data(withJSONObject: body),
            bytes.count <= 16 * 1024 * 1024
        else { return }
        event(body)
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let url = navigationAction.request.url?.absoluteString
        if initialNavigation && (url == "about:blank" || url == "https://executor.invalid/") {
            initialNavigation = false
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            lost("navigation")
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        lost("processTerminated")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        lost("bootstrapFailed")
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        lost("bootstrapFailed")
    }

    private func lost(_ reason: String) {
        guard !closed else { return }
        close()
        event(["kind": "lost", "reason": reason])
    }
}

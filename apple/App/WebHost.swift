import WebKit
import SwiftUI
import AppleCore
@MainActor final class WebHost: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    unowned let model: AppModel
    let view: WKWebView
    private var policy: BridgePolicy?
    private var tasks: [Int: Task<Void, Never>] = [:]
    init(model: AppModel) {
        self.model = model
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: model.profiles.currentID)
        config.setURLSchemeHandler(AssetSchemeHandler(), forURLScheme: "tigerest")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        view = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.add(self, name: "tigerestNative")
        view.navigationDelegate = self; view.uiDelegate = self
        view.isOpaque = false; view.backgroundColor = .clear
        view.allowsBackForwardNavigationGestures = true
        view.customUserAgent = "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1 TigerestTheater/2.6.0"
        #if DEBUG
        view.isInspectable = true
        #endif
        model.bridge.output = { [weak self] in self?.emit($0) }
        model.settings.changed = { [weak model] section, value in model?.bridge.emit("settings", "sectionValueUpdate", [.string(section), value]) }
    }
    private func resource(_ file: String) throws -> String {
        try String(contentsOf: Bundle.main.resourceURL!.appending(path: "Web/" + file), encoding: .utf8)
    }
    func open(_ address: ServerAddress) {
        resetPage()
        policy = BridgePolicy(origin: address.origin)
        do {
            let bootstrap: JSONValue = .object([
                "version": .string("2.6.0"), "deviceName": .string("iPad"), "platform": .string("ipad"), "mode": .string("desktop"),
                "userAgent": .string(view.customUserAgent!), "scriptPath": .string("tigerest://bundle"), "mpvConfigMode": .string("embedded"), "mpvConfigDir": .string("iPad 应用内配置"),
                "settings": .object(model.settings.values.mapValues(JSONValue.object)), "sections": .array(model.settings.sections), "settingsDescriptions": .object(model.settings.descriptions),
                "capabilities": .object(["downloads": .bool(true), "nativePlayback": .bool(true), "desktopWindowControls": .bool(false), "selfUpdate": .bool(false), "rife": .bool(false)])
            ])
            let json = String(decoding: try JSONEncoder().encode(bootstrap), as: UTF8.self)
            let manifest = try JSONDecoder().decode(JSONValue.self, from: Data(resource("manifest.json").utf8))
            var script = "(()=>{if(window!==window.top || location.origin!==\(String(decoding: try JSONEncoder().encode(address.origin), as: UTF8.self)))return;window.__tigerestBootstrap=\(json);\n"
            script += try resource("ipadBridge.js")
            for file in manifest["scripts"].array ?? [] { script += "\n;(function(){\n" + (try resource(file.string!)) + "\n}).call(window);" }
            let css = String(decoding: try JSONEncoder().encode(resource("ipadResponsive.css")), as: UTF8.self)
            script += "\ndocument.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent=\(css);document.head.appendChild(style);});"
            script += try resource("ipadResponsive.js") + "\n})();"
            view.configuration.userContentController.removeAllUserScripts()
            view.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            view.load(URLRequest(url: address.endpoint("web/index.html")))
        } catch { model.error = "无法载入客户端界面资源" }
    }
    private func resetPage() { model.community.clear(); model.diagnostics.setScope(""); policy?.advancePage(); tasks.values.forEach { $0.cancel() }; tasks.removeAll() }
    func close() { resetPage(); view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName:"tigerestNative"); view.navigationDelegate=nil }
    func emit(_ value: JSONValue) {
        guard let policy, let url = view.url, Self.origin(url) == policy.origin else { return }
        view.callAsyncJavaScript("window.__tigerestReceive?.(message)", arguments: ["message": value.foundation], in: nil, in: .page, completionHandler: nil)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        let port = origin.port == 0 ? "" : ":\(origin.port)"
        guard let policy, policy.allows(origin: "\(origin.protocol)://\(origin.host)\(port)", isMainFrame: message.frameInfo.isMainFrame),
              let text = message.body as? String, let request = try? BridgeRequest.decode(Data(text.utf8)) else { return }
        let epoch = policy.epoch
        tasks[request.id]?.cancel()
        tasks[request.id] = Task { [weak self] in
            guard let self else { return }
            let response: JSONValue
            do { response = .object(["id": .number(Double(request.id)), "result": try await model.bridge.handle(request)]) }
            catch { response = .object(["id": .number(Double(request.id)), "error": .string((error as? CoreError)?.localizedDescription ?? "客户端操作失败，请重试")]) }
            guard !Task.isCancelled, self.policy?.isCurrent(epoch) == true else { return }
            tasks[request.id] = nil; emit(response)
        }
    }
    private static func origin(_ url: URL) -> String? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = ""; parts.query = nil; parts.fragment = nil
        return parts.string.flatMap { try? ServerAddress($0).origin }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
        guard let url = action.request.url, Self.origin(url) == policy?.origin else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { resetPage(); model.loading = true }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.loading = false }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { model.error = "网页进程已结束，请点重新载入。"; model.loading = false }
    private func failed(_ error: Error) { model.loading = false; if (error as NSError).code != NSURLErrorCancelled { model.error = "服务器页面加载失败，请检查地址和网络后重试。（\((error as NSError).code)）" } }
}
struct WebView: UIViewRepresentable {
    let host: WebHost
    func makeUIView(context: Context) -> WKWebView { host.view }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

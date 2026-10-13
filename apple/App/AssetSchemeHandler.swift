import WebKit
import UniformTypeIdentifiers
final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard task.request.httpMethod == "GET", let url = task.request.url,
              url.host == "bundle", let root = Bundle.main.resourceURL?.appending(path: "Web").standardizedFileURL else {
            task.didFailWithError(URLError(.unsupportedURL)); return
        }
        let file = root.appending(path: url.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), !url.path.contains(".."),
              let data = try? Data(contentsOf: file) else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mime, "Access-Control-Allow-Origin": "*"])!
        task.didReceive(response); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}

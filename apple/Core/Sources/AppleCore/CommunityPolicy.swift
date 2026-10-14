import Foundation
public enum CommunityPolicy {
    public static func safe(_ value: String) -> Bool { !value.isEmpty && value.utf8.count <= 4000 && !value.unicodeScalars.contains { $0.value <= 32 || $0.value == 127 } }
    public static func guid(_ value: String) -> String {
        let clean = value.replacingOccurrences(of: "-", with: "").lowercased()
        return clean.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil ? clean : ""
    }
    public static func allowed(_ request: JSONValue, trusted: String) -> Bool {
        guard let path = request["path"].string, let method = request["method"].string else { return false }
        let body = request["body"].string ?? "", headers = request["headers"].object ?? [:], type = request["responseType"].string ?? "json"
        let upload = path == "/me/avatar" && method == "PUT"
        guard path.count <= 4096, path.range(of: #"^/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9%_.~=&+/-]*)?$"#, options: .regularExpression) != nil,
              !path.contains("//"), !path.contains(".."), ["GET", "POST", "PUT", "DELETE"].contains(method), ["json", "image"].contains(type),
              body.utf8.count <= (upload ? 393216 : 16384), !["GET", "DELETE"].contains(method) || body.isEmpty else { return false }
        if type == "image" {
            guard method == "GET", headers.count == 1, headers["Authorization"] != nil,
                  path.range(of: #"^/avatars/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?v=[a-f0-9]{64}$"#, options: .regularExpression) != nil else { return false }
        }
        if upload && (headers.count != 1 || headers["Authorization"] == nil) { return false }
        if path == "/mapping-capabilities" { return method == "GET" && headers.isEmpty }
        if path == "/auth/emby" && method == "POST" {
            return headers.count == 3 && !guid(trusted).isEmpty && guid(headers["X-Emby-Server-Id"]?.string ?? "") == guid(trusted) && ["X-Emby-Token", "X-Emby-Server-Id", "X-Emby-User-Id"].allSatisfy { safe(headers[$0]?.string ?? "") }
        }
        return headers.isEmpty || (headers.count == 1 && (headers["Authorization"]?.string ?? "").range(of: #"^Bearer [A-Za-z0-9._~+/-]{1,4000}={0,2}$"#, options: .regularExpression) != nil)
    }
}
public enum DiagnosticRedactor {
    public static func redact(_ text: String) -> String {
        guard text.utf8.count <= 65536 else { return "[redacted private diagnostic record]" }
        var decoded = text
        for _ in 0..<3 { decoded = decoded.removingPercentEncoding ?? decoded }
        if decoded.range(of: #"(?i)(token|password|passwd|pwd|secret|authorization|cookie|credential|api[-_]?key|user[-_]?id|server[-_]?id|session[-_]?id)[\s\"'\\]*[:=]|\b(bearer|basic)\s+\S+|[^\s]@[^\s]"#, options: .regularExpression) != nil { return "[redacted private diagnostic record]" }
        return decoded.replacingOccurrences(of: #"(?i)(?:https?|file|content)://[^\s<>\"']+"#, with: "[redacted URL]", options: .regularExpression)
    }
}

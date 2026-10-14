import Foundation
public struct ServerAddress: Sendable {
    public let baseURL: URL
    public let origin: String
    public init(_ input: String) throws {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.contains("\\"), !text.unicodeScalars.contains(where: { $0.value < 32 }),
              var parts = URLComponents(string: text),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.port == nil || (1...65535).contains(parts.port!) else { throw CoreError.invalidAddress }
        var decoded = parts.percentEncodedPath
        for _ in 0..<3 { decoded = decoded.removingPercentEncoding ?? decoded }
        guard !decoded.contains("\\"), !decoded.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else { throw CoreError.invalidAddress }
        parts.scheme = scheme; parts.host = host
        if (scheme == "https" && parts.port == 443) || (scheme == "http" && parts.port == 80) { parts.port = nil }
        parts.percentEncodedPath = "/" + parts.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if !parts.percentEncodedPath.hasSuffix("/") { parts.percentEncodedPath += "/" }
        guard let url = parts.url else { throw CoreError.invalidAddress }
        baseURL = url
        parts.path = ""; origin = parts.string!
    }
    public func endpoint(_ path: String) -> URL { baseURL.appending(path: path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) }
}
public enum CoreError: String, Error, LocalizedError, Sendable {
    case invalidAddress = "请输入完整且不含账号信息的 HTTP(S) 服务器地址"
    case invalidRequest = "客户端请求无效"
    case invalidSetting = "设置值无效或不适用于当前平台"
    case invalidProfile = "配置档不存在"
    public var errorDescription: String? { rawValue }
}

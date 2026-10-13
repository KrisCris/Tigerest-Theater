import Foundation
public struct BridgeRequest: Codable, Sendable {
    public let id: Int
    public let component: String
    public let method: String
    public let args: [JSONValue]
    public static func decode(_ data: Data) throws -> Self {
        guard data.count <= 1_048_576 else { throw CoreError.invalidRequest }
        let request = try JSONDecoder().decode(Self.self, from: data)
        let identifier = /^[A-Za-z][A-Za-z0-9_]{0,79}$/
        guard request.id > 0, request.id <= 9_007_199_254_740_991,
              request.component.wholeMatch(of: identifier) != nil,
              request.method.wholeMatch(of: identifier) != nil,
              request.args.count <= 32 else { throw CoreError.invalidRequest }
        return request
    }
}
public struct BridgePolicy: Sendable {
    public let origin: String
    public private(set) var epoch: UInt64 = 0
    public init(origin: String) { self.origin = origin }
    public func allows(origin: String, isMainFrame: Bool) -> Bool {
        isMainFrame && (try? ServerAddress(origin).origin) == self.origin
    }
    @discardableResult public mutating func advancePage() -> UInt64 { epoch &+= 1; return epoch }
    public func isCurrent(_ value: UInt64) -> Bool { value == epoch }
}

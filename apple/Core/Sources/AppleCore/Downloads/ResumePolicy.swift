import Foundation
public enum ResumeDecision: Equatable, Sendable { case append, restart, complete, reject }
public enum ResumePolicy {
    public static func decide(status: Int, headers: [String:String], received: Int64, validator: String?) -> ResumeDecision {
        guard received >= 0 else { return .reject }
        let headers = Dictionary(headers.map { ($0.key.lowercased(),$0.value) },uniquingKeysWith: { _,last in last })
        if status == 200 { return .restart }
        if status == 206 {
            if let validator, headers["etag"] != validator { return .restart }
            guard let text = headers["content-range"], let match = text.wholeMatch(of: /^bytes (\d+)-(\d+)\/(\d+)$/),
                  let start=Int64(match.1),let end=Int64(match.2),let total=Int64(match.3),start==received,end>=start,total>end else { return .reject }
            return .append
        }
        if status == 416, let validator, headers["etag"] == validator,
           let text = headers["content-range"],let match = text.wholeMatch(of:/^bytes \*\/(\d+)$/),let total=Int64(match.1),total==received { return .complete }
        return .reject
    }
}
public struct OfflineProgress: Codable, Sendable {
    public let position: Double, recordedAt: Date
    public init(position: Double, recordedAt: Date) { self.position = position; self.recordedAt = recordedAt }
    public func mayUpload(serverUpdatedAt: Date) -> Bool { position.isFinite && position >= 0 && recordedAt > serverUpdatedAt }
}
public struct DownloadRecord: Codable, Identifiable, Sendable {
    public let id: String
    public let owner: String
    public let itemID: String
    public let title: String
    public let fileName: String
    public var status: String = "paused"
    public var received: Int64 = 0
    public var total: Int64 = -1
    public var validator: String?
    public var resumeOffset: Int64 = 0
    public var error: String = ""
    public var progress: OfflineProgress?
    public init(id: String, owner: String, itemID: String, title: String, fileName: String) { self.id=id;self.owner=owner;self.itemID=itemID;self.title=title;self.fileName=fileName }
}

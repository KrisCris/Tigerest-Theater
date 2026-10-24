import Foundation
import AppleCore
@MainActor final class DiagnosticsLog {
    private var scope = ""
    private var records: [(Date, String)] = []
    private var truncated = false
    func setScope(_ value: String) {
        guard value != scope else { return }
        scope = String(value.prefix(256)); records.removeAll(); truncated = false
    }
    func record(_ level: String, _ message: String) {
        guard !scope.isEmpty else { return }
        let now = Date(), safe = ["info", "warning", "error"].contains(level) ? level : "info"
        records.append((now, "\(now.ISO8601Format()) [\(safe)] Universal - \(DiagnosticRedactor.redact(message))\n"))
        records.removeAll { now.timeIntervalSince($0.0) > 600 }
        while records.count > 2048 || records.reduce(0, { $0 + $1.1.utf8.count }) > 1_048_576 { records.removeFirst(); truncated = true }
    }
    func collect() -> JSONValue {
        guard !scope.isEmpty else { return .object([:]) }
        let now = Date(); let text = records.filter { (0...600).contains(now.timeIntervalSince($0.0)) }.map(\.1).joined()
        guard !text.isEmpty else { return .object([:]) }
        return .object(["capturedAt": .string(now.ISO8601Format()), "truncated": .bool(truncated), "logText": .string(text)])
    }
}

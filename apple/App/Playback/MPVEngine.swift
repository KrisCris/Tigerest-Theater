import UIKit
import Metal
import Libmpv
import AppleCore
struct MPVFailure: Error { let operation: String; let code: Int32; var message: String { "播放器无法应用 \(operation)（\(code)）" } }
/// Owns exactly one media generation. Event polling is serialized on the main actor.
@MainActor final class MPVEngine {
    private var handle: OpaquePointer?
    let layer: CAMetalLayer
    init(layer: CAMetalLayer) throws {
        self.layer = layer
        guard let handle = mpv_create() else { throw CoreError.invalidRequest }
        self.handle = handle
        do {
            // The pinned iOS MPVKit disables Lua; ytdl/osc script options do not exist.
            let options = ["config":"no", "vo":"gpu-next", "gpu-api":"vulkan", "gpu-context":"moltenvk", "hwdec":"videotoolbox", "idle":"yes", "keep-open":"yes", "input-default-bindings":"no", "tls-verify":"yes", "save-position-on-quit":"no", "tls-ca-file":Bundle.main.resourceURL!.appending(path:"Web/cacert.pem").path]
            for (name, value) in options { try check(mpv_set_option_string(handle, name, value), operation: name) }
            var pointer = Int64(Int(bitPattern: Unmanaged.passUnretained(layer).toOpaque()))
            try check(mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &pointer))
            try check(mpv_initialize(handle))
        } catch { mpv_terminate_destroy(handle); self.handle = nil; throw error }
    }
    func close() { if let handle { self.handle = nil; mpv_terminate_destroy(handle) } }
    private func check(_ code: Int32, operation: String = "初始化") throws { if code < 0 { throw MPVFailure(operation:operation,code:code) } }
    func command(_ args: [String]) throws {
        guard let handle else { throw CoreError.invalidRequest }
        let strings = args.map { strdup($0) }
        defer { strings.forEach { free($0) } }
        var pointers = strings.map { UnsafePointer<CChar>($0) } + [nil]
        try check(mpv_command_async(handle, 0, &pointers))
    }
    func set(_ name: String, _ value: String) throws {
        guard let handle else { throw CoreError.invalidRequest }
        try check(mpv_set_property_string(handle, name, value),operation:name)
    }
    func string(_ name: String) -> String {
        guard let handle, let pointer = mpv_get_property_string(handle, name) else { return "" }
        defer { mpv_free(pointer) }; return String(cString: pointer)
    }
    func number(_ name: String) -> Double { Double(string(name)) ?? 0 }
    func flag(_ name: String) -> Bool { string(name) == "yes" }
    func json(_ name: String) -> JSONValue {
        guard let handle else { return .null }
        var node = mpv_node()
        guard mpv_get_property(handle, name, MPV_FORMAT_NODE, &node) >= 0 else { return .null }
        defer { mpv_free_node_contents(&node) }
        return Self.value(node)
    }
    private static func value(_ node: mpv_node) -> JSONValue {
        switch node.format {
        case MPV_FORMAT_STRING: return node.u.string.map { .string(String(cString: $0)) } ?? .null
        case MPV_FORMAT_FLAG: return .bool(node.u.flag != 0)
        case MPV_FORMAT_INT64: return .number(Double(node.u.int64))
        case MPV_FORMAT_DOUBLE: return .number(node.u.double_)
        case MPV_FORMAT_NODE_ARRAY, MPV_FORMAT_NODE_MAP:
            guard let list = node.u.list?.pointee, let values = list.values, list.num >= 0, list.num < 100_000 else { return .null }
            if node.format == MPV_FORMAT_NODE_ARRAY { return .array((0..<Int(list.num)).map { value(values[$0]) }) }
            var result: [String: JSONValue] = [:]
            for index in 0..<Int(list.num) { if let key = list.keys?[index] { result[String(cString: key)] = value(values[index]) } }
            return .object(result)
        default: return .null
        }
    }
    enum Event { case loaded, ended, failed }
    func events() -> [Event] {
        guard let handle else { return [] }
        var result: [Event] = []
        for _ in 0..<64 {
            guard let event = mpv_wait_event(handle, 0)?.pointee, event.event_id != MPV_EVENT_NONE else { break }
            if event.event_id == MPV_EVENT_FILE_LOADED { result.append(.loaded) }
            if event.event_id == MPV_EVENT_END_FILE, let data = event.data {
                let end = data.assumingMemoryBound(to: mpv_event_end_file.self).pointee
                if end.reason == MPV_END_FILE_REASON_EOF { result.append(.ended) }
                else if end.reason == MPV_END_FILE_REASON_ERROR { result.append(.failed) }
            }
        }
        return result
    }
}
final class MetalSurface: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metal: CAMetalLayer { layer as! CAMetalLayer }
    override init(frame: CGRect) {
        super.init(frame: frame); backgroundColor = .black
        metal.device = MTLCreateSystemDefaultDevice(); metal.framebufferOnly = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.scale ?? traitCollection.displayScale
        metal.contentsScale = scale
        metal.drawableSize = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    }
}

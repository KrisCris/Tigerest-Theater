import UIKit
import Metal
import Libmpv
import AppleCore
struct MPVFailure: Error { let operation: String; let code: Int32; var message: String { "播放器无法应用 \(operation)（\(code)）" } }
/// Owns exactly one media generation. Event polling is serialized on the main actor.
@MainActor final class MPVEngine {
    private var handle: OpaquePointer?
    private var originalSettings: [String: String] = [:]
    private var qualityBaseline: [String: String] = [:]
    let layer: CAMetalLayer
    init(layer: CAMetalLayer) throws {
        self.layer = layer
        // libplacebo picks an HDR10 swapchain for HDR/Dolby Vision content when
        // target-colorspace-hint is on. On iOS mpv does not configure the layer
        // (unlike its macOS context), so allow EDR here; SDR swapchains are unaffected.
        // tvOS has no EDR layer property; Apple TV keeps its previous output path.
        #if !os(tvOS)
        layer.wantsExtendedDynamicRangeContent = true
        #endif
        guard let handle = mpv_create() else { throw CoreError.invalidRequest }
        self.handle = handle
        do {
            // The pinned iOS MPVKit disables Lua; ytdl/osc script options do not exist.
            // avfoundation (AVSampleBufferAudioRenderer) keeps 5.1/7.1 with its layout, so
            // the system can spatialize it for AirPods; RemoteIO only gets two channels
            // on those routes (iPad and Apple TV alike). audiounit remains the fallback.
            let audioOutput = "avfoundation,audiounit"
            let options = ["profile":"high-quality", "config":"no", "vo":"gpu-next", "gpu-api":"vulkan", "gpu-context":"moltenvk", "hwdec":"videotoolbox", "ao":audioOutput, "idle":"yes", "keep-open":"yes", "input-default-bindings":"no", "tls-verify":"yes", "save-position-on-quit":"no", "tls-ca-file":Bundle.main.resourceURL!.appending(path:"Web/cacert.pem").path, "sub-fonts-dir":Bundle.main.resourceURL!.appending(path:"SubtitleFonts").path, "sub-font":"Source Han Sans SC"]
            for (name, value) in options { try check(mpv_set_option_string(handle, name, value), operation: name) }
            var pointer = Int64(Int(bitPattern: Unmanaged.passUnretained(layer).toOpaque()))
            try check(mpv_set_option(handle, "wid", MPV_FORMAT_INT64, &pointer))
            #if PLAYBACK_VALIDATION
            if ProcessInfo.processInfo.arguments.contains("--rife-playback-probe") || ProcessInfo.processInfo.arguments.contains("--rife-stability-probe") {
                try check(mpv_set_option_string(handle, "log-file", URL.cachesDirectory.appending(path:"rife-mpv.log").path))
                try check(mpv_set_option_string(handle, "msg-level", "all=warn"))
            }
            if ProcessInfo.processInfo.arguments.contains("--rife-audio-buffer-probe") {
                try check(mpv_set_option_string(handle, "audio-buffer", "0.05"))
            }
            if ProcessInfo.processInfo.arguments.contains("--rife-default-audio-buffer-probe") {
                try check(mpv_set_option_string(handle, "audio-buffer", "0.2"))
            }
            #endif
            try check(mpv_initialize(handle))
        } catch { mpv_terminate_destroy(handle); self.handle = nil; throw error }
    }
    #if PLAYBACK_VALIDATION
    func fixturePNG() -> Data? {
        guard let handle else {return nil}
        let words:[String]=["screenshot-raw","video","rgba"];let args=words.map{strdup($0)};defer{args.forEach{free($0)}}
        var pointers=args.map{UnsafePointer<CChar>($0)}+[nil],node=mpv_node()
        guard mpv_command_ret(handle,&pointers,&node)>=0 else {return nil}
        defer{mpv_free_node_contents(&node)}
        guard let list=node.u.list?.pointee,node.format==MPV_FORMAT_NODE_MAP else{return nil}
        var fields:[String:mpv_node]=[:]
        for i in 0..<Int(list.num) {if let key=list.keys?[i],let value=list.values?[i]{fields[String(cString:key)]=value}}
        guard let w=fields["w"]?.u.int64,let h=fields["h"]?.u.int64,let stride=fields["stride"]?.u.int64,
              fields["data"]?.format==MPV_FORMAT_BYTE_ARRAY,let bytes=fields["data"]?.u.ba?.pointee,let pointer=bytes.data,
              let provider=CGDataProvider(data:Data(bytes:pointer,count:bytes.size) as CFData),
              let image=CGImage(width:Int(w),height:Int(h),bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:Int(stride),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.last.rawValue),provider:provider,decode:nil,shouldInterpolate:false,intent:.defaultIntent) else{return nil}
        return UIImage(cgImage:image).pngData()
    }
    #endif
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
        if name == "glsl-shaders", value.isEmpty {
            // A string empty value produces [""] on mpv; send a real empty list.
            var list = mpv_node_list(), node = mpv_node()
            node.format = MPV_FORMAT_NODE_ARRAY
            try withUnsafeMutablePointer(to: &list) { pointer in
                node.u.list = pointer
                try check(mpv_set_property(handle, name, MPV_FORMAT_NODE, &node), operation: name)
            }
        } else { try check(mpv_set_property_string(handle, name, value), operation: name) }
    }
    /// Restore a cleared client preference to the value present in the playback core.
    func setting(_ name: String, _ value: String?) throws {
        if originalSettings[name] == nil { originalSettings[name] = string(name) }
        try set(name, value ?? originalSettings[name]!)
    }
    func qualitySetting(_ key: String, _ value: String) throws {
        if qualityBaseline[key] == nil { qualityBaseline[key] = string(key) }
        try set(key, value)
    }
    func resetQuality() throws {
        for (key, value) in qualityBaseline { try set(key, value) }
        qualityBaseline.removeAll()
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
            guard let list = node.u.list?.pointee, list.num >= 0, list.num < 100_000 else { return .null }
            if list.num == 0 { return node.format == MPV_FORMAT_NODE_ARRAY ? .array([]) : .object([:]) }
            guard let values = list.values else { return .null }
            if node.format == MPV_FORMAT_NODE_ARRAY { return .array((0..<Int(list.num)).map { value(values[$0]) }) }
            var result: [String: JSONValue] = [:]
            for index in 0..<Int(list.num) { if let key = list.keys?[index] { result[String(cString: key)] = value(values[index]) } }
            return .object(result)
        default: return .null
        }
    }
    enum Event { case loaded, restarted, ended, failed }
    func events() -> [Event] {
        guard let handle else { return [] }
        var result: [Event] = []
        for _ in 0..<64 {
            guard let event = mpv_wait_event(handle, 0)?.pointee, event.event_id != MPV_EVENT_NONE else { break }
            if event.event_id == MPV_EVENT_FILE_LOADED { result.append(.loaded) }
            if event.event_id == MPV_EVENT_PLAYBACK_RESTART { result.append(.restarted) }
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

import Foundation
import Darwin
import AppleCore
@MainActor enum RifePlaybackValidation {
    static func memoryMB() -> Double {
        var info=task_vm_info_data_t(),count=mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size/MemoryLayout<integer_t>.size)
        let result=withUnsafeMutablePointer(to:&info) { pointer in pointer.withMemoryRebound(to:integer_t.self,capacity:Int(count)) { task_info(mach_task_self_,task_flavor_t(TASK_VM_INFO),$0,&count) } }
        return result==KERN_SUCCESS ? Double(info.phys_footprint)/1048576 : -1
    }
    static func run(_ model: AppModel) async {
        var report: [[String: Any]] = []
        let reportURL=URL.cachesDirectory.appending(path:"rife-playback.json")
        try? FileManager.default.removeItem(at:reportURL)
        func save() { if let data = try? JSONSerialization.data(withJSONObject: report,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:reportURL,options:.atomic) } }
        let player=model.player
        let cases:[(String,Bool,String,String)]=[("baseline",false,"native","device-rife-1080.mp4"),("rife-native",true,"native","device-rife-1080.mp4"),("rife-shader",true,"tigerest-default","device-rife-1080.mp4"),("unsupported-720p",true,"native","device-fixture.mp4"),("sustained-60s",true,"native","device-rife-long.mp4")]
        for (name,enabled,preset,filename) in cases {
            var row: [String: Any] = ["case":name,"enabled":enabled]
            func checkpoint() { report.append(row);save();report.removeLast() }
            do {
                let media=model.profiles.directory.appending(path:filename)
                if !FileManager.default.fileExists(atPath:media.path) { try FileManager.default.copyItem(at:URL.cachesDirectory.appending(path:filename),to:media) }
                try model.settings.set("video","aiRife",.bool(enabled));try player.selectQuality(QualitySelection(preset:preset))
                try player.dispatch("load",[.string(media.absoluteString),.object(["autoplay":.bool(true)]),.object(["title":.string("RIFE 播放链路验证")]),.number(1),.number(-1)])
                try await PlaybackValidation.wait { player.position>2 }
                guard let e=player.engine else { throw PlaybackValidation.Failure.incorrectOutput }
                row["at2"]=e.json("vf-metadata/tigerest-rife").foundation
                row["memory2MB"]=memoryMB();row["fps"]=e.number("estimated-vf-fps")
                row["output"]=e.json("video-out-params").foundation
                row["audioRate"]=e.number("audio-out-params/samplerate");row["hwdec"]=e.string("hwdec-current")
                row["passes"]=e.json("vo-passes").foundation
                checkpoint()
                if name=="unsupported-720p" {
                    guard e.json("vf-metadata/tigerest-rife")["status"].string=="unsupported-source", e.json("vf-metadata/tigerest-rife")["generated"].string=="0" else { throw PlaybackValidation.Failure.incorrectOutput }
                } else {
                    if name=="rife-native" || name=="baseline" {
                        let image=URL.cachesDirectory.appending(path:name+".png")
                        if let png=e.fixturePNG() {try png.write(to:image,options:.atomic);row["capturedFrame"]=true}else{row["capturedFrame"]=false}
                    }
                    try player.dispatch("pause",[]);try player.dispatch("seekTo",[.number(6000)])
                    try await PlaybackValidation.wait { abs(player.position-6)<0.2 }
                    row["afterSeek"]=e.json("vf-metadata/tigerest-rife").foundation;checkpoint()
                    try player.dispatch("play",[])
                    try await PlaybackValidation.wait { player.position>8 }
                    row["at8"]=e.json("vf-metadata/tigerest-rife").foundation
                    row["dropCount8"]=e.number("frame-drop-count");row["avsync8"]=e.number("avsync");row["memory8MB"]=memoryMB()
                    if enabled { guard (Double(e.json("vf-metadata/tigerest-rife")["generated"].string ?? "0") ?? 0)>20,e.number("estimated-vf-fps")==48 else { throw PlaybackValidation.Failure.incorrectOutput } }
                    checkpoint()
                    if name=="sustained-60s" {
                        try await PlaybackValidation.wait {player.position>30};row["memory30MB"]=memoryMB();checkpoint()
                        try await PlaybackValidation.wait {player.position>55};row["memory55MB"]=memoryMB()
                        row["at55"]=e.json("vf-metadata/tigerest-rife").foundation;row["drops55"]=e.number("frame-drop-count");row["avsync55"]=e.number("avsync");checkpoint()
                    }
                    // Natural EOF must drain the pending original frame and stop.
                    try await PlaybackValidation.wait { !player.active };row["eof"]="success"
                }
                row["result"]="success"
            } catch { row["result"]="failed";row["error"]=String(describing:error) }
            checkpoint();player.stop(notify:false);report.append(row);save()
        }
    }
}

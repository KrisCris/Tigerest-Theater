import UIKit
import AppleCore
@MainActor enum DanmakuFrameValidation {
    static var frames:[(Double,Double)]=[]
    static let enabled=ProcessInfo.processInfo.arguments.contains("--danmaku-frame-probe")
    static func record(host:Double,position:Double) {if enabled {frames.append((host,position))}}
    static func run(_ model:AppModel) async {
        var report:[String:Any]=[:]
        do {
            try model.settings.set("video","aiRife",.bool(false))
            try model.settings.set("danmaku","displayarea",.number(1))
            try model.settings.set("danmaku","fontsize",.number(40))
            try model.settings.set("danmaku","scrolltime",.number(8))
            try model.player.selectQuality(QualitySelection())
            let media=model.profiles.directory.appending(path:"device-fixture.mp4")
            if !FileManager.default.fileExists(atPath:media.path) {try FileManager.default.copyItem(at:URL.cachesDirectory.appending(path:"device-fixture.mp4"),to:media)}
            try model.player.dispatch("load",[.string(media.absoluteString),.object(["autoplay":.bool(true)]),.object(["title":.string("弹幕刷新验证")]),.number(1),.number(-1)])
            try await PlaybackValidation.wait {model.player.position>0.3}
            let rows=(0..<1200).map { index in ["p":"\(Double(index)*0.02),1,16777215","m":"流畅弹幕 \(index) 测试文字 平滑移动"] }
            try model.danmaku.importData(JSONSerialization.data(withJSONObject:["comments":rows]),name:"frame-fixture")
            try await Task.sleep(for:.seconds(2));frames=[]
            try await Task.sleep(for:.seconds(6))
            let samples=frames,elapsed=(samples.last?.0 ?? 0)-(samples.first?.0 ?? 0)
            let gaps=zip(samples.dropFirst(),samples).map{$0.0.0-$0.1.0}.sorted()
            let moved=zip(samples.dropFirst(),samples).filter{abs($0.0.1-$0.1.1)>0.0001}.count
            report=["renderSamples":samples.count,"elapsed":elapsed,"renderFPS":Double(max(0,samples.count-1))/max(elapsed,0.001),"movingFPS":Double(moved)/max(elapsed,0.001),"p95FrameMs":gaps.isEmpty ? 0 : gaps[Int(Double(gaps.count-1)*0.95)]*1000,"videoFPS":model.player.engine?.number("estimated-vf-fps") ?? 0,"comments":rows.count,"result":"measured"]
            try model.player.dispatch("pause",[])
            try await Task.sleep(for:.milliseconds(300));let frozen=frames.last?.1 ?? -1
            try await Task.sleep(for:.milliseconds(300))
            report["pauseFrozen"]=abs((frames.last?.1 ?? 0)-frozen)<0.001
            try model.player.dispatch("seekTo",[.number(3000)]);try model.player.dispatch("play",[])
            try await PlaybackValidation.wait {model.player.position>3 && model.player.position<4}
            // Small seeks must reset only after the core publishes the target.
            var seekChecks:[Bool]=[]
            for delta in [0.3,-0.3] {
                try model.player.dispatch("seekTo",[.number((model.player.position+delta)*1000)])
                try await Task.sleep(for:.milliseconds(350))
                seekChecks.append(abs((frames.last?.1 ?? -1)-model.player.position)<0.14)
            }
            report["smallSeeksAligned"]=seekChecks.allSatisfy{$0}
            try model.player.dispatch("setPlaybackRate",[.number(2000)])
            try await Task.sleep(for:.milliseconds(250));let rateStart=frames.last?.1 ?? 0
            try await Task.sleep(for:.seconds(1));let rateDelta=(frames.last?.1 ?? 0)-rateStart
            report["doubleRateDelta"]=rateDelta
            report["smooth"]=(report["movingFPS"] as? Double ?? 0)>55 && (report["p95FrameMs"] as? Double ?? 100)<25 && report["pauseFrozen"] as? Bool == true && seekChecks.allSatisfy{$0} && (1.7...2.3).contains(rateDelta)
            model.player.stop(notify:false)
        } catch {report=["result":"failed","error":String(describing:error)]}
        if let data=try? JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]) {try? data.write(to:URL.cachesDirectory.appending(path:"danmaku-frames.json"),options:.atomic)}
    }
}

extension DanmakuFrameValidation {
    static func glyphs(_ model:AppModel) async {
        let sample="好看 什么空之箱 梦开始的地方 Blue Box"
        let font=UIFont.systemFont(ofSize:36), color=UIColor.white
        var variants:[UIImage]=[]
        for mode in 0..<4 {
            let format=UIGraphicsImageRendererFormat();format.scale=2;format.opaque=false
            if mode==3 {format.preferredRange = .standard}
            let image=UIGraphicsImageRenderer(size:CGSize(width:1000,height:70),format:format).image { ctx in
                var attrs:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:color]
                if mode==0 || mode==3 {attrs[.strokeColor]=UIColor.black;attrs[.strokeWidth] = -2.0}
                (sample as NSString).draw(at:CGPoint(x:8,y:8),withAttributes:attrs)
            }
            let output=mode==2 ? DanmakuGlyph.image(text:sample,width:990,font:font,color:0xffffff,outline:0.72,shadow:0,scale:2) : image
            variants.append(output)
            try? output.pngData()?.write(to:URL.cachesDirectory.appending(path:"danmaku-glyph-\(mode).png"))
        }
        let f=UIGraphicsImageRendererFormat();f.scale=2;f.opaque=true
        let comparison=UIGraphicsImageRenderer(size:CGSize(width:1000,height:340),format:f).image {ctx in
            UIColor.darkGray.setFill();ctx.fill(CGRect(x:0,y:0,width:1000,height:340))
            for (i,img) in variants.enumerated() {img.draw(at:CGPoint(x:0,y:i*85))}
        }
        try? comparison.pngData()?.write(to:URL.cachesDirectory.appending(path:"danmaku-glyph-comparison.png"))
        // Compare opaque fill interiors against an unoutlined reference at the
        // same pixel origin. Internal contour outlines must never erase them.
        let fixed=variants[2],format=UIGraphicsImageRendererFormat();format.scale=2;format.opaque=false
        let plain=UIGraphicsImageRenderer(size:fixed.size,format:format).image {_ in
            (sample as NSString).draw(at:CGPoint(x:3,y:3),withAttributes:[.font:font,.foregroundColor:UIColor.white])
        }
        func pixels(_ image:UIImage)->[UInt8] {
            let cg=image.cgImage!,w=cg.width,h=cg.height
            var data=[UInt8](repeating:0,count:w*h*4)
            data.withUnsafeMutableBytes { bytes in
                let context=CGContext(data:bytes.baseAddress,width:w,height:h,bitsPerComponent:8,bytesPerRow:w*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
                context.draw(cg,in:CGRect(x:0,y:0,width:w,height:h))
            }
            return data
        }
        let reference=pixels(plain),actual=pixels(fixed)
        var interior=0,missing=0
        for i in stride(from:0,to:reference.count,by:4) where reference[i]>250 && reference[i+1]>250 && reference[i+2]>250 && reference[i+3]>250 {
            interior+=1;if actual[i]<240 || actual[i+1]<240 || actual[i+2]<240 {missing+=1}
        }
        let report:[String:Any]=["interiorPixels":interior,"damagedInteriorPixels":missing,"passed":interior>1000 && missing==0]
        try? JSONSerialization.data(withJSONObject:report,options:.prettyPrinted).write(to:URL.cachesDirectory.appending(path:"danmaku-glyph.json"))
    }
}

import SwiftUI
import UIKit
import AppleCore

/// Static glyph textures, moved at display cadence. SwiftUI/player observation
/// remains at control cadence and never determines the scrolling frame rate.
struct DanmakuOverlay<Player: ObservableObject & DanmakuPlaybackState>: UIViewRepresentable {
    @ObservedObject var repository: DanmakuRepository
    @ObservedObject var player: Player
    func makeUIView(context: Context) -> DanmakuSurface { DanmakuSurface() }
    func updateUIView(_ view: DanmakuSurface, context: Context) {view.repository=repository;view.player=player}
}
@MainActor private final class DanmakuDisplayTarget: NSObject {
    weak var view: DanmakuSurface?
    @objc func step(_ link: CADisplayLink) {view?.drawFrame()}
}
@MainActor final class DanmakuSurface: UIView {
    weak var repository: DanmakuRepository?
    weak var player: (any DanmakuPlaybackState)?
    private var displayLink: CADisplayLink?
    private let target=DanmakuDisplayTarget()
    private var clock=DanmakuClock(), key=""
    private var layout=DanmakuLayout([],width:1,lanes:1,duration:8)
    private var labels:[Int:CALayer]=[:]
    private let images=NSCache<NSNumber,UIImage>()
    private var font=UIFont.systemFont(ofSize:20),line=28.0,lanes=1,outline=1.0,shadow=0.0
    override init(frame: CGRect) {
        super.init(frame:frame)
        isOpaque=false;backgroundColor = .clear;isUserInteractionEnabled=false;clipsToBounds=true
        images.totalCostLimit=32*1024*1024;images.countLimit=256;target.view=self
    }
    required init?(coder:NSCoder) {fatalError("init(coder:) has not been implemented")}
    override func didMoveToWindow() {
        super.didMoveToWindow();displayLink?.invalidate();displayLink=nil
        guard let window else {return}
        let link=CADisplayLink(target:target,selector:#selector(DanmakuDisplayTarget.step(_:)))
        let maximum=Float(window.screen.maximumFramesPerSecond)
        link.preferredFrameRateRange=CAFrameRateRange(minimum:min(60,maximum),maximum:maximum,preferred:maximum)
        link.add(to:.main,forMode:.common);displayLink=link
    }
    deinit {displayLink?.invalidate()}
    private func clearLayers() {for value in labels.values {value.removeFromSuperlayer()};labels.removeAll()}
    private func prepare(_ repository:DanmakuRepository) {
        let settings=repository.host,scale=bounds.width/1920
        let size=max(10,(settings.setting("danmaku","fontsize").number ?? 50)*scale)
        let duration=settings.setting("danmaku","scrolltime").number ?? 15
        let area=settings.setting("danmaku","displayarea").number ?? 0.2
        let bold=settings.setting("danmaku","bold").bool == true
        outline=(settings.setting("danmaku","outline").number ?? 1)*scale
        shadow=(settings.setting("danmaku","shadow").number ?? 0)*scale
        let next="\(ObjectIdentifier(repository))/\(repository.revision)/\(bounds.size)/\(size)/\(bold)/\(duration)/\(area)/\(outline)/\(shadow)"
        layer.opacity=Float(settings.setting("danmaku","opacity").number ?? 0.7)
        guard key != next else {return};key=next;clearLayers();images.removeAllObjects()
        font=UIFont.systemFont(ofSize:size,weight:bold ? .bold : .regular)
        // The bottom fifth of the picture stays clear for subtitles at any display area.
        line=size+8*scale;lanes=max(1,Int(max(0,bounds.height-40)*min(area,0.8)/line))
        var widths:[String:Double]=[:]
        let measured=(area>0 ? repository.allComments : []).map { source in
            // One scrolling lane per comment; keep all words from imported
            // multiline captions instead of clipping them to one bitmap line.
            let comment=DanmakuComment(time:source.time,text:source.text.components(separatedBy:.newlines).joined(separator:" "),mode:source.mode,color:source.color)
            let width=widths[comment.text] ?? min(8192,ceil((comment.text as NSString).size(withAttributes:[.font:font]).width))
            widths[comment.text]=width;return (comment,width)
        }
        layout=DanmakuLayout(measured,width:bounds.width,lanes:lanes,duration:duration)
    }
    private func image(for row:DanmakuLayout.Row) -> UIImage {
        let id=NSNumber(value:row.id)
        if let image=images.object(forKey:id) {return image}
        let image=DanmakuGlyph.image(text:row.comment.text,width:row.width,font:font,color:row.comment.color,
                                    outline:outline,shadow:shadow,scale:window?.screen.scale ?? 2)
        images.setObject(image,forKey:id,cost:image.cgImage.map{$0.bytesPerRow*$0.height} ?? 0);return image
    }
    fileprivate func drawFrame() {
        guard let repository,let player,repository.enabled,player.active,bounds.width>0 else {clearLayers();return}
        #if PLAYBACK_VALIDATION
        let traceStart = CACurrentMediaTime()
        defer { PlaybackPerformanceTrace.recordDanmakuFrame(host: traceStart, duration: CACurrentMediaTime() - traceStart, visible: labels.count) }
        #endif
        prepare(repository)
        let host=CACurrentMediaTime()
        let position=clock.position(mediaTime:player.position,hostTime:host,playing:!player.paused && !player.buffering,rate:player.rate,epoch:player.danmakuEpoch)
        let visible=layout.visible(at:position),ids=Set(visible.map(\.id))
        CATransaction.begin();CATransaction.setDisableActions(true)
        for id in Array(labels.keys) where !ids.contains(id) {labels.removeValue(forKey:id)?.removeFromSuperlayer()}
        for row in visible {
            let label:CALayer
            if let existing=labels[row.id] {label=existing}
            else {
                let bitmap=image(for:row);label=CALayer();label.contents=bitmap.cgImage;label.contentsScale=bitmap.scale
                label.bounds=CGRect(origin:.zero,size:bitmap.size);layer.addSublayer(label);labels[row.id]=label
            }
            let x=row.scrolls ? bounds.width-(position-row.comment.time)*row.speed+row.width/2 : bounds.width/2
            let y=20+Double(row.lane)*line+line/2
            label.position=CGPoint(x:x,y:y)
        }
        CATransaction.commit()
        #if PLAYBACK_VALIDATION
        DanmakuFrameValidation.record(host:host,position:position)
        #endif
    }
}

/// Stroke glyph silhouettes, then fill once. Attributed-string stroke+fill
/// outlines overlapping CJK contours inside each glyph, cutting up the strokes.
@MainActor enum DanmakuGlyph {
    static func image(text:String,width:Double,font:UIFont,color:UInt32,outline:Double,shadow:Double,scale:CGFloat) -> UIImage {
        let padding=ceil(max(outline,shadow*2)+2)
        let size=CGSize(width:max(1,width+padding*2),height:ceil(font.lineHeight+padding*2))
        let format=UIGraphicsImageRendererFormat();format.opaque=false;format.scale=scale
        return UIGraphicsImageRenderer(size:size,format:format).image { ctx in
            var attrs:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:UIColor.black]
            if shadow>0 {
                ctx.cgContext.saveGState()
                ctx.cgContext.setShadow(offset:CGSize(width:shadow,height:shadow),blur:shadow,color:UIColor.black.cgColor)
                (text as NSString).draw(at:CGPoint(x:padding,y:padding),withAttributes:attrs)
                ctx.cgContext.restoreGState()
            }
            if outline>0 {
                for y in [-outline,0,outline] {for x in [-outline,0,outline] where x != 0 || y != 0 {
                    (text as NSString).draw(at:CGPoint(x:padding+x,y:padding+y),withAttributes:attrs)
                }}
            }
            attrs[.foregroundColor]=UIColor(red:CGFloat((color>>16)&255)/255,green:CGFloat((color>>8)&255)/255,blue:CGFloat(color&255)/255,alpha:1)
            (text as NSString).draw(at:CGPoint(x:padding,y:padding),withAttributes:attrs)
        }
    }
}

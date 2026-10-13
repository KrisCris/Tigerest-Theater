import SwiftUI
import UIKit
import AppleCore

/// Static glyph textures, moved at display cadence. SwiftUI/player observation
/// remains at control cadence and never determines the scrolling frame rate.
struct DanmakuOverlay: UIViewRepresentable {
    @ObservedObject var repository: DanmakuRepository
    @ObservedObject var player: PlaybackController
    func makeUIView(context: Context) -> DanmakuSurface { DanmakuSurface() }
    func updateUIView(_ view: DanmakuSurface, context: Context) {view.repository=repository;view.player=player}
}
@MainActor private final class DanmakuDisplayTarget: NSObject {
    weak var view: DanmakuSurface?
    @objc func step(_ link: CADisplayLink) {view?.drawFrame()}
}
@MainActor final class DanmakuSurface: UIView {
    weak var repository: DanmakuRepository?
    weak var player: PlaybackController?
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
    private func prepare(_ repository:DanmakuRepository,_ player:PlaybackController) {
        let settings=player.model.settings,scale=bounds.width/1920
        let size=max(10,(settings.get("danmaku","fontsize").number ?? 50)*scale)
        let duration=settings.get("danmaku","scrolltime").number ?? 15
        let area=settings.get("danmaku","displayarea").number ?? 0.2
        let bold=settings.get("danmaku","bold").bool == true
        outline=(settings.get("danmaku","outline").number ?? 1)*scale
        shadow=(settings.get("danmaku","shadow").number ?? 0)*scale
        let next="\(repository.revision)/\(bounds.size)/\(size)/\(bold)/\(duration)/\(area)/\(outline)/\(shadow)"
        layer.opacity=Float(settings.get("danmaku","opacity").number ?? 0.7)
        guard key != next else {return};key=next;clearLayers();images.removeAllObjects()
        font=UIFont.systemFont(ofSize:size,weight:bold ? .bold : .regular)
        line=size+8*scale;lanes=max(1,Int(max(0,bounds.height-40)*area/line))
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
        let color=row.comment.color,padding=ceil(max(outline,shadow*2)+2)
        var attributes:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:UIColor(red:CGFloat((color>>16)&255)/255,green:CGFloat((color>>8)&255)/255,blue:CGFloat(color&255)/255,alpha:1)]
        if outline>0 {attributes[.strokeColor]=UIColor.black;attributes[.strokeWidth] = -100*outline/font.pointSize}
        if shadow>0 {let value=NSShadow();value.shadowColor=UIColor.black;value.shadowBlurRadius=shadow;value.shadowOffset=CGSize(width:shadow,height:shadow);attributes[.shadow]=value}
        let size=CGSize(width:max(1,row.width+padding*2),height:ceil(font.lineHeight+padding*2))
        let format=UIGraphicsImageRendererFormat();format.opaque=false;format.scale=window?.screen.scale ?? 2
        let image=UIGraphicsImageRenderer(size:size,format:format).image { _ in
            (row.comment.text as NSString).draw(at:CGPoint(x:padding,y:padding),withAttributes:attributes)
        }
        images.setObject(image,forKey:id,cost:image.cgImage.map{$0.bytesPerRow*$0.height} ?? 0);return image
    }
    fileprivate func drawFrame() {
        guard let repository,let player,repository.enabled,player.active,bounds.width>0 else {clearLayers();return}
        prepare(repository,player)
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
            let x=row.comment.mode==1 ? bounds.width-(position-row.comment.time)*row.speed+row.width/2 : bounds.width/2
            let y=row.comment.mode==4 ? bounds.height-20-Double(lanes-row.lane)*line : 20+Double(row.lane)*line+line/2
            label.position=CGPoint(x:x,y:y)
        }
        CATransaction.commit()
        #if PLAYBACK_VALIDATION
        DanmakuFrameValidation.record(host:host,position:position)
        #endif
    }
}

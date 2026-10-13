import SwiftUI
import AppleCore
struct DanmakuOverlay: View {
    @ObservedObject var repository: DanmakuRepository
    @ObservedObject var player: PlaybackController
    var body: some View {
        TimelineView(.animation(minimumInterval:1.0/30,paused:player.paused || player.buffering)) { _ in
            Canvas { context, size in
                let settings = player.model.settings
                let fontSize = settings.get("danmaku","fontsize").number ?? 26
                let duration = settings.get("danmaku","scrolltime").number ?? 8
                let area = settings.get("danmaku","displayarea").number ?? 0.8
                let lanes = max(1,Int(size.height * area / (fontSize+8)))
                let position = player.engine?.number("time-pos") ?? player.position
                let comments = repository.visible(at:position,duration:duration)
                context.opacity = settings.get("danmaku","opacity").number ?? 0.8
                var occupied = Array(repeating:-Double.infinity,count:lanes)
                for comment in comments.prefix(180) {
                    let age = position-comment.time
                    guard age >= 0, age <= duration else { continue }
                    let color = Color(red:Double((comment.color>>16)&255)/255,green:Double((comment.color>>8)&255)/255,blue:Double(comment.color&255)/255)
                    let text = context.resolve(Text(comment.text).font(.system(size:fontSize,weight:settings.get("danmaku","bold").bool == true ? .bold : .regular)).foregroundStyle(color))
                    let width = text.measure(in:CGSize(width:10000,height:fontSize*2)).width
                    let speed = (size.width+width)/duration
                    guard let lane = occupied.indices.first(where: { occupied[$0] <= comment.time }) else { continue }
                    occupied[lane] = comment.time + (width + 40)/speed
                    let x = comment.mode == 1 ? size.width-age*speed+width/2 : size.width/2
                    let y = comment.mode == 4 ? size.height-Double(lane+1)*(fontSize+8)-30 : Double(lane)*(fontSize+8)+40
                    var shaded = context
                    shaded.addFilter(.shadow(color:.black,radius:settings.get("danmaku","shadow").number ?? 1,x:1,y:1))
                    shaded.draw(text,at:CGPoint(x:x,y:y))
                }
            }
        }.allowsHitTesting(false)
    }
}

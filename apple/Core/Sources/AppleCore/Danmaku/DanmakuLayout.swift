import Foundation
/// Assign lanes once per source/style/viewport. Recomputing only the current
/// time window makes an on-screen comment jump when an older comment expires.
public struct DanmakuLayout: Sendable {
    public struct Row: Sendable {
        public let id: Int
        public let comment: DanmakuComment
        public let width: Double, duration: Double, speed: Double
        public let lane: Int
        public var end: Double { comment.time+duration }
    }
    public let rows: [Row]
    private let longest: Double
    public init(_ measured: [(DanmakuComment,Double)], width: Double, lanes: Int, duration: Double) {
        longest=max(duration,5)
        guard lanes>0,width>0,duration>0 else { rows=[];return }
        var rolling=Array<Row?>(repeating:nil,count:lanes),fixed=Array(repeating:-Double.infinity,count:lanes),output:[Row]=[]
        let sorted=measured.enumerated().sorted { $0.element.0.time == $1.element.0.time ? $0.offset<$1.offset : $0.element.0.time<$1.element.0.time }
        for (id,pair) in sorted {
            let (comment,textWidth)=pair, speed=(width+textWidth)/duration
            let indices=comment.mode==4 ? Array(fixed.indices.reversed()) : Array(fixed.indices)
            let lane: Int?
            if comment.mode==1 {
                lane=rolling.indices.first { index in
                    guard let old=rolling[index],old.end>comment.time else { return true }
                    let elapsed=comment.time-old.comment.time
                    return elapsed*old.speed>=old.width+20 && (speed<=old.speed || width-(old.end-comment.time)*speed>=20)
                }
            } else { lane=indices.first { fixed[$0]<=comment.time } }
            guard let lane else {continue}
            let row=Row(id:id,comment:comment,width:textWidth,duration:comment.mode==1 ? duration : 5,speed:speed,lane:lane)
            if comment.mode==1 { rolling[lane]=row } else {fixed[lane]=row.end}
            output.append(row)
        }
        rows=output
    }
    public func visible(at time: Double) -> [Row] {
        var low=0,high=rows.count
        while low<high {let mid=(low+high)/2;if rows[mid].comment.time<time-longest {low=mid+1}else{high=mid}}
        var result:[Row]=[]
        while low<rows.count,rows[low].comment.time<=time,result.count<180 { if rows[low].end>=time {result.append(rows[low])};low+=1 }
        return result
    }
}

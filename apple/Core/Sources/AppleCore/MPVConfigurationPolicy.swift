import Foundation
public enum MPVConfigurationPolicy {
    public static func parse(_ text: String, shaderRoot: URL) throws -> [String:String] {
        guard text.utf8.count<=65536 else {throw CoreError.invalidSetting}
        let allowed:Set<String>=["scale","cscale","dscale","tscale","deband","deband-iterations","deband-threshold","deband-range","deband-grain","sigmoid-upscaling","correct-downscaling","linear-downscaling","tone-mapping","hdr-compute-peak","target-peak","interpolation","video-sync","glsl-shaders","sub-scale","sub-pos","sub-font-size","sub-border-size","sub-shadow-offset"]
        var result:[String:String]=[:]
        for raw in text.components(separatedBy:.newlines) {
            let line=raw.trimmingCharacters(in:.whitespaces)
            if line.isEmpty || line.hasPrefix("#") {continue}
            let pair=line.split(separator:"=",maxSplits:1).map { $0.trimmingCharacters(in:.whitespaces) }
            guard pair.count==2,allowed.contains(pair[0]),!pair[1].isEmpty,pair[1].count<=4096 else {throw CoreError.invalidSetting}
            if pair[0]=="glsl-shaders" {
                let path=URL(fileURLWithPath:pair[1]).standardizedFileURL
                guard path.path.hasPrefix(shaderRoot.standardizedFileURL.path+"/"),!pair[1].contains(":"),!pair[1].contains("..") else {throw CoreError.invalidSetting}
            } else {
                guard pair[1].range(of:"^[A-Za-z0-9_.+-]+$",options:.regularExpression) != nil else {throw CoreError.invalidSetting}
            }
            result[pair[0]]=pair[1]
        }
        return result
    }
}

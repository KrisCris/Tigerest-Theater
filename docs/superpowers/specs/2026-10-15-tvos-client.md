# Apple TV first playable client

User requested Apple TV development after publishing Mac/iPad2.7.0. Those attachments are now live and their downloaded hashes have been verified. This first increment targets tvOS26+ with Xcode27 and the existing pinned MPVKit television slices.

## Experience

Native SwiftUI focus navigation for Siri Remote: dedicated-server/self-host selection; direct Emby login; libraries and continue-watching; folder/series/season/episode navigation; episode labels SXXEXX; playback, pause, seek, progress reporting, and resume. Store the token in device-local Keychain, never the password. Reuse bundled server defaults rather than hard-coding an alternative. Error and retry states must be usable with the remote. Existing iPad/Mac behavior and profiles remain untouched.

## Architecture

A Foundation-only EmbyClient in AppleCore owns bounded authenticated requests and playback contracts. TV model owns session persistence and navigation; views consume JSONValue item metadata consistent with the existing bridge. A small television playback controller reuses MPVEngine/CAMetalLayer, independent of iPad WebHost, brightness/volume gestures and RIFE. TV project generation is separate from the iPad generator; same pinned MPVKit revision, tvOS26 deployment, bundle top.tigerest.theater.tv.

TV has no supported WKWebView UI, so a web-wrapper port is unsuitable. Rewriting the media engine is unnecessary: existing MPVKit supplies tvOS device/simulator slices. Initial native UI is the first playable foundation, not a claim of desktop-feature parity. RIFE/danmaku/downloads/community and advanced settings remain follow-up work after TV playback validation.

## Contracts

EmbySession: Codable/Sendable {serverURL,userID,accessToken,deviceID:String}.
EmbyClient actor init(session:urlSession:) throws; static publicInfo(server:urlSession:) async throws ->String; static login(server:username:password:deviceID:urlSession:) async throws ->EmbySession.
Methods: libraries(), resumeItems(), children(of:JSONValue) ->[JSONValue]; item(id:)->JSONValue; playback(item:)->EmbyPlayback, all async throws. imageURL(for:type:maxWidth:) nonisolated ->URL?. report(_:playback:position:paused:) async throws.
EmbyPlayback: Sendable {url:URL,headers:[String:String],item:JSONValue,mediaSourceID:String,playSessionID:String,startSeconds:Double}.
EmbyPlaybackEvent cases start/progress/stop.
TVAppModel holds @Published session,client,libraries,resume,error,busy and player:TVPlaybackController; TVRootView(model:) and TVPlayerView(player:) compose the app. TVPlaybackController exposes active,paused,buffering,position,duration,title,error; play(_ playback:EmbyPlayback, client:EmbyClient), togglePause(), seek(by:Double),stop().

## Verification and limits

URLProtocol fixtures test authentication body, path-prefix retention, episode queries, playback URL selection, token isolation and session progress ticks. Compile a tvOS Release device target and simulator; run focus/UI/playback fixtures on simulator where supported. Pair the LAN Apple TV through Xcode and install if the device permits; actual login credentials remain entered on device. Distinguish simulator/local fixtures from production-server and physical-device playback. Never imply unpaired hardware has been tested.

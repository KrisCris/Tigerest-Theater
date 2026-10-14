import Foundation
import CryptoKit
import AppleCore
@MainActor final class DownloadCoordinator: NSObject, ObservableObject, @preconcurrency URLSessionDownloadDelegate {
    static var backgroundCompletions: [String: () -> Void] = [:]
    let profile: UUID
    let directory: URL
    private let credentials: KeychainStore
    private var currentOwner: String
    @Published private(set) var records: [DownloadRecord] = []
    private var tasks: [String: URLSessionDownloadTask] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier:"top.tigerest.theater.downloads." + profile.uuidString)
        config.sessionSendsLaunchEvents = true; config.isDiscretionary = false
        config.timeoutIntervalForResource = 7 * 24 * 3600
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        return URLSession(configuration:config,delegate:self,delegateQueue:.main)
    }()
    var changed: ((JSONValue) -> Void)?
    init(profile: UUID, directory: URL) throws {
        self.profile=profile; self.directory=directory.appending(path:"Downloads"); credentials=KeychainStore(profile:profile)
        try FileManager.default.createDirectory(at:self.directory,withIntermediateDirectories:true)
        let ownerFile=self.directory.appending(path:"owner.txt")
        currentOwner=(try? String(contentsOf:ownerFile,encoding:.utf8)) ?? ""
        records=(try? JSONDecoder().decode([DownloadRecord].self,from:Data(contentsOf:self.directory.appending(path:"downloads.json")))) ?? []
        super.init()
        session.getAllTasks { [weak self] existing in
            Task { @MainActor in
                guard let self else { return }
                for task in existing { if let download=task as? URLSessionDownloadTask,let id=task.taskDescription,self.records.contains(where:{$0.id==id}) { self.tasks[id]=download } else { task.cancel() } }
                for index in self.records.indices where self.records[index].status=="downloading" && self.tasks[self.records[index].id]==nil { self.records[index].status="paused" }
                self.persist()
            }
        }
    }
    var visible: [DownloadRecord] { records.filter { $0.owner == currentOwner } }
    func setOwner(_ session: JSONValue) {
        let address=session["address"].string ?? "",user=session["userId"].string ?? ""
        let next = user.isEmpty ? "" : SHA256.hash(data:Data((address+"\n"+user).utf8)).map { String(format:"%02x",$0) }.joined()
        guard next != currentOwner else { return }
        currentOwner=next;try? next.write(to:directory.appending(path:"owner.txt"),atomically:true,encoding:.utf8); changed?(snapshot)
    }
    private func persist() {
        do { try JSONEncoder().encode(records).write(to:directory.appending(path:"downloads.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) }
        catch { records.indices.forEach { if records[$0].status=="downloading" { records[$0].error="下载记录保存失败" } } }
        changed?(snapshot)
    }
    func localURL(_ record: DownloadRecord) -> URL { directory.appending(path:record.id+"."+record.fileName.split(separator:".").last.map(String.init).filterExtension) }
    var snapshot: JSONValue { .array(visible.map { record in
        .object(["id":.string(record.id),"itemId":.string(record.itemID),"title":.string(record.title),"fileName":.string(record.fileName),"status":.string(record.status),"received":.number(Double(record.received)),"total":.number(Double(record.total)),"error":.string(record.error),"localUrl":record.status=="completed" ? .string(localURL(record).absoluteString) : .null])
    }) }
    private func index(_ id: String) throws -> Int { guard let index=records.firstIndex(where:{$0.id==id && $0.owner==currentOwner}) else { throw CoreError.invalidRequest }; return index }
    func start(_ value: JSONValue) throws -> String {
        guard let text=value["url"].string,let url=URL(string:text),["http","https"].contains(url.scheme),url.host != nil,url.user==nil,url.password==nil else { throw CoreError.invalidAddress }
        let id=UUID().uuidString
        let name=String((value["fileName"].string ?? "media.mp4").prefix(240))
        var record=DownloadRecord(id:id,owner:currentOwner,itemID:value["itemId"].string ?? "",title:String((value["title"].string ?? name).prefix(240)),fileName:name)
        try credentials.write(Data(text.utf8),server:"offline-downloads",account:id)
        record.status="downloading";records.append(record)
        let task=session.downloadTask(with:URLRequest(url:url));task.taskDescription=id;tasks[id]=task
        persist();task.resume();return id
    }
    func pause(_ id: String) throws {
        let index=try index(id); guard let task=tasks.removeValue(forKey:id) else { return }
        records[index].status="paused";persist()
        task.cancel { [weak self] data in
            Task { @MainActor in guard let self, self.records.contains(where:{$0.id==id}) else { return };if let data { try? data.write(to:self.directory.appending(path:id+".resume"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) } }
        }
    }
    func resume(_ id: String) throws {
        let index=try index(id);guard tasks[id]==nil,records[index].status != "completed" else { return }
        let resume=directory.appending(path:id+".resume")
        let task: URLSessionDownloadTask
        if let data=try? Data(contentsOf:resume) { task=session.downloadTask(withResumeData:data) }
        else {
            guard let data=credentials.read(server:"offline-downloads",account:id),let text=String(data:data,encoding:.utf8),let url=URL(string:text) else { throw CoreError.invalidAddress }
            records[index].received=0;records[index].resumeOffset=0;records[index].validator=nil
            task=session.downloadTask(with:url)
        }
        task.taskDescription=id;tasks[id]=task;records[index].status="downloading";records[index].error="";persist();task.resume()
    }
    func remove(_ id: String) throws {
        let index=try index(id),record=records[index]
        tasks.removeValue(forKey:id)?.cancel()
        for url in [localURL(record),directory.appending(path:id+".resume")] { if FileManager.default.fileExists(atPath:url.path) { try FileManager.default.removeItem(at:url) } }
        try credentials.write(nil,server:"offline-downloads",account:id)
        records.remove(at:index);persist()
    }
    func importFile(_ url: URL) throws {
        let granted=url.startAccessingSecurityScopedResource();defer { if granted { url.stopAccessingSecurityScopedResource() } }
        let id=UUID().uuidString
        var record=DownloadRecord(id:id,owner:currentOwner,itemID:"",title:url.deletingPathExtension().lastPathComponent,fileName:url.lastPathComponent)
        try FileManager.default.copyItem(at:url,to:localURL(record));record.status="completed"
        record.received=Int64((try localURL(record).resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0);record.total=record.received
        records.append(record);persist()
    }
    func saveProgress(_ id: String, seconds: Double) {
        guard let index=try? index(id) else { return }
        records[index].progress=OfflineProgress(position:seconds,recordedAt:Date());persist()
    }
    func dispatch(_ method: String, _ args: [JSONValue]) throws -> JSONValue {
        let id=args.first?.string ?? ""
        switch method {
        case "startDownload": return .string(try start(args.first ?? .null))
        case "downloads": return snapshot
        case "downloadInfo": _ = try index(id);return snapshot.array?.first { $0["id"].string==id } ?? .null
        case "pauseDownload": try pause(id)
        case "resumeDownload": try resume(id)
        case "removeDownload": try remove(id)
        default: throw CoreError.invalidRequest
        }
        return .bool(true)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id=downloadTask.taskDescription,let index=records.firstIndex(where:{$0.id==id}), tasks[id]===downloadTask else { return }
        records[index].received=totalBytesWritten;records[index].total=totalBytesExpectedToWrite
        if records[index].validator==nil { records[index].validator=(downloadTask.response as? HTTPURLResponse)?.value(forHTTPHeaderField:"ETag") }
        persist()
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64, expectedTotalBytes: Int64) {
        guard let id=downloadTask.taskDescription,let index=records.firstIndex(where:{$0.id==id}) else { return }
        records[index].resumeOffset=fileOffset;records[index].total=expectedTotalBytes
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id=downloadTask.taskDescription,let index=records.firstIndex(where:{$0.id==id}),tasks[id]===downloadTask,let response=downloadTask.response as? HTTPURLResponse else { return }
        do {
            let headers=Dictionary(uniqueKeysWithValues:response.allHeaderFields.compactMap { key,value in (key as? String).map { ($0.lowercased(),String(describing:value)) } })
            let decision=ResumePolicy.decide(status:response.statusCode,headers:headers,received:records[index].resumeOffset,validator:records[index].validator)
            guard (response.statusCode==200 && decision == .restart) || (response.statusCode==206 && decision == .append) else { throw URLError(.badServerResponse) }
            let length=Int64((try location.resourceValues(forKeys:[.fileSizeKey])).fileSize ?? 0)
            let expected=response.statusCode==206 ? headers["content-range"]?.split(separator:"/").last.flatMap { Int64($0) } : headers["content-length"].flatMap(Int64.init)
            guard length>0,expected==nil || expected==length else { throw URLError(.badServerResponse) }
            let target=localURL(records[index]);if FileManager.default.fileExists(atPath:target.path) { try FileManager.default.removeItem(at:target) }
            try FileManager.default.moveItem(at:location,to:target)
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:target.path)
            records[index].status="completed";records[index].received=length;records[index].total=length;records[index].error=""
            try? FileManager.default.removeItem(at:directory.appending(path:id+".resume"))
        } catch { records[index].status="error";records[index].error="下载校验失败，请重新下载";try? FileManager.default.removeItem(at:directory.appending(path:id+".resume")) }
        persist()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id=task.taskDescription,let index=records.firstIndex(where:{$0.id==id}), tasks[id]===task else { return }
        tasks[id]=nil
        if let error, records[index].status != "completed" {
            records[index].status="paused";records[index].error="下载中断，可点击继续"
            if let data=(error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data { try? data.write(to:directory.appending(path:id+".resume"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) }
        }
        persist()
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { if let id=session.configuration.identifier { Self.backgroundCompletions.removeValue(forKey:id)?() } }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Download URLs may contain server credentials. An external CDN needs its own signed URL.
        guard let before=task.originalRequest?.url,let after=request.url,before.scheme==after.scheme,before.host==after.host,before.port==after.port else { completionHandler(nil);return }
        completionHandler(request)
    }
}
private extension Optional where Wrapped==String {
    var filterExtension: String { guard let value=self, value.count<=12,value.allSatisfy({$0.isASCII && ($0.isLetter || $0.isNumber)}) else { return "media" };return value.lowercased() }
}

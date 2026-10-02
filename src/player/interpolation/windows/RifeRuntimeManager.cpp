#include "RifeRuntimeManager.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSharedPointer>
#include <QTemporaryDir>
#include <QTimer>

namespace rife {
namespace {
QJsonObject readObject(const QString& path){QFile file(path);if(!file.open(QIODevice::ReadOnly))return {};return QJsonDocument::fromJson(file.readAll()).object();}
QString hashFile(const QString& path){QFile file(path);if(!file.open(QIODevice::ReadOnly))return {};QCryptographicHash hash(QCryptographicHash::Sha256);if(!hash.addData(&file))return {};return QString::fromLatin1(hash.result().toHex());}
QByteArray canonical(const QJsonObject& value){
    // Qt sorts object keys. Match Python's compact, ASCII-escaped identity,
    // including UTF-16 surrogate pairs, while preserving the files array order.
    const auto text=QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact));
    QByteArray bytes;
    for(const QChar c:text){if(c.unicode()<128)bytes.append(char(c.unicode()));else bytes.append("\\u"+QByteArray::number(c.unicode(),16).rightJustified(4,'0'));}
    return bytes;
}
QString keyFor(const QJsonObject& identity){return QString::fromLatin1(QCryptographicHash::hash(canonical(identity),QCryptographicHash::Sha256).toHex());}
bool validHash(const QString& digest){return QRegularExpression("^[0-9a-f]{64}$").match(digest).hasMatch();}
QString privateFile(const QString& root,QString relative){
    relative.replace('\\','/');
    if(relative.isEmpty()||QDir::isAbsolutePath(relative)||relative.contains(':')||relative.contains(QChar('\0')))return {};
    for(const auto& part:relative.split('/'))if(part.isEmpty()||part=="."||part=="..")return {};
    const QFileInfo target(QDir(root).filePath(relative));
    const auto canonical=target.canonicalFilePath();
    if(canonical.isEmpty()||!canonical.startsWith(root+"/",Qt::CaseInsensitive))return {};
    for(auto path=target.absoluteFilePath();path!=root;path=QFileInfo(path).absolutePath())if(QFileInfo(path).isSymLink())return {};
    return canonical;
}
bool verifiedEntry(const QString& root,const QJsonObject& manifest,const QString& relative){
    const auto path=privateFile(root,relative);if(path.isEmpty()||!QFileInfo(path).isFile())return false;
    for(const auto& value:manifest["files"].toArray()){
        const auto entry=value.toObject();
        if(entry["path"]==relative){const auto digest=entry["sha256"].toString();return validHash(digest)&&QFileInfo(path).size()==entry["size"].toInteger()&&hashFile(path)==digest;}
    }
    return false;
}
}
RifeRuntimeManager::RifeRuntimeManager(QObject* parent,Launch launcher):QObject(parent),launch(std::move(launcher)){
    if(!launch)launch=[](QProcess* process,const QString& program,const QStringList& args,const QProcessEnvironment& env){
        process->setProgram(program);process->setArguments(args);process->setProcessEnvironment(env);process->start();
    };
}
RifeRuntimeManager::~RifeRuntimeManager(){
    cancelActive();
    // These are only this manager's helpers. Closing the Python wrapper's Job
    // terminates its compiler descendants; do not wait on an mpv/driver thread.
    for(auto* process:findChildren<QProcess*>()){if(process->state()!=QProcess::NotRunning){process->kill();process->waitForFinished(1000);}}
}
void RifeRuntimeManager::cancelActive(){
    ++serial;
    if(!cancellation.isEmpty()){QFile file(cancellation);if(file.open(QIODevice::WriteOnly))file.close();}
    if(active&&active->state()!=QProcess::NotRunning)active->kill();
    active.clear();cancellation.clear();compiling=false;probing=false;
}
bool RifeRuntimeManager::configure(const QString& runtime,const QString& engineCache,const QString& monitorPath,const QString& scriptPath,bool extensionVerified){
    cancelActive();available=false;manifest={};gpu={};error.clear();cacheHit=false;
    const QFileInfo runtimeInfo(runtime),cacheInfo(engineCache);
    root=runtimeInfo.canonicalFilePath();
    if(root.isEmpty()||runtimeInfo.isSymLink()||cacheInfo.isSymLink()||!QFileInfo(monitorPath).isFile()||!QFileInfo(scriptPath).isFile())return false;
    manifest=readObject(root+"/runtime.json");
    const auto python=manifest["entrypoints"].toObject()["python"].toString();
    if(manifest["schemaVersion"]!=1||manifest["backend"]!="windows-nvidia-trt"||manifest["runtimeId"].toString().isEmpty()||
       manifest["models"].toArray().isEmpty()||!verifiedEntry(root,manifest,python)||
       !verifiedEntry(root,manifest,"scripts/probe_runtime.py")||!verifiedEntry(root,manifest,"scripts/prepare_engine.py")||
       (extensionVerified&&!verifiedEntry(root,manifest,manifest["entrypoints"].toObject()["worker"].toString())))return false;
    if(!QDir().mkpath(engineCache))return false;
    cache=QFileInfo(engineCache).canonicalFilePath();monitor=QFileInfo(monitorPath).canonicalFilePath();script=QFileInfo(scriptPath).canonicalFilePath();
    if(cache.isEmpty())return false;
    if(model().isEmpty())modelId=manifest["models"].toArray().first().toObject()["id"].toString();
    probing=true;
    run(extensionVerified?manifest["entrypoints"].toObject()["worker"].toString():QStringLiteral("scripts/probe_runtime.py"),{},true,[this](bool ok,const QJsonObject& result,const QString& message){
        probing=false;gpu=result["gpu"].toObject();
        const bool identityValid=QRegularExpression("^[0-9a-f]{32}$").match(gpu["uuid"].toString()).hasMatch()&&
            !gpu["driverVersion"].toString().isEmpty()&&!gpu["computeCapability"].toString().isEmpty()&&gpu["deviceId"].toInt(-1)==0;
        available=ok&&result["ok"].toBool()&&result["privateLibrariesOnly"].toBool()&&identityValid;
        const auto reported=result["errors"].toArray().isEmpty()?QString():result["errors"].toArray().first().toObject()["message"].toString();
        error=available?QString():!message.isEmpty()?message:!reported.isEmpty()?reported:QStringLiteral("Private NVIDIA runtime probe failed");
        emit runtimeReady(available,error);
    });
    return true;
}
QJsonObject RifeRuntimeManager::model()const{for(const auto& m:manifest["models"].toArray())if(m.toObject()["id"]==modelId)return m.toObject();return {};}
bool RifeRuntimeManager::select(const QString& id,int fps){
    if(fps!=0&&fps!=60&&fps!=120&&fps!=240)return false;
    bool found=false;for(const auto& m:manifest["models"].toArray())if(m.toObject()["id"]==id)found=true;
    if(!found)return false;
    if(id==modelId&&fps==targetFps)return true;
    // Selection also invalidates a queued cache-hit notification. A probe is
    // independent of the model and may finish with the new selection.
    if(!probing)cancelActive();modelId=id;targetFps=fps;cacheHit=false;error.clear();return true;
}
QJsonObject RifeRuntimeManager::identityFor(const SourceInfo& source)const{
    const auto selected=model();const int implementation=selected["implementation"].toInt(),alignment=selected["alignment"].toInt();
    if(!available||!qualify(source,{3840,2160,60.001}).enabled||
       !((implementation==2&&alignment==1)||(implementation==1&&(alignment==32||alignment==64||alignment==128))))return {};
    const QJsonObject runtime{{"runtimeId",manifest["runtimeId"]},{"versions",manifest["versions"]},{"files",manifest["files"]}};
    return {{"schemaVersion",1},{"runtimeFingerprint",keyFor(runtime)},{"modelId",modelId},{"modelSha256",selected["sha256"]},
        {"gpu",gpu},{"precision",implementation==2?"fp16-fp16-io":"fp16-fp32-io"},{"implementation",implementation},
        {"shape",QJsonArray{1,implementation==2?7:11,((source.height+alignment-1)/alignment)*alignment,((source.width+alignment-1)/alignment)*alignment}},
        {"builder",QJsonObject{{"optimizationLevel",3},{"tf32",false},{"maxAuxStreams",0}}}};
}
QString RifeRuntimeManager::cachedEngine(const SourceInfo& source)const{
    const auto identity=identityFor(source);if(identity.isEmpty())return {};
    const auto key=keyFor(identity),path=privateFile(cache,key+"/model.engine"),marker=privateFile(cache,key+"/complete.json");
    if(path.isEmpty()||marker.isEmpty())return {};
    const auto complete=readObject(marker);const auto size=complete["size"].toInteger();
    const auto digest=complete["sha256"].toString();
    return validHash(digest)&&complete["identity"].toObject()==identity&&size>=1024&&QFileInfo(path).size()==size&&hashFile(path)==digest?path:QString();
}
RuntimePaths RifeRuntimeManager::pathsFor(const SourceInfo& source)const{
    RuntimePaths paths;paths.backend=Backend::TensorRT;paths.available=available;paths.runtime=root;paths.model=modelId;
    paths.plugin=monitor;paths.script=script;paths.trtPlugin=privateFile(root,manifest["entrypoints"].toObject()["plugin"].toString());
    paths.alignment=model()["alignment"].toInt(1);paths.implementation=model()["implementation"].toInt(2);paths.numStreams=2;
    paths.factor=targetFps?integerMultiplier({source.fpsNum,source.fpsDen},targetFps):2;
    paths.engine=cachedEngine(source);return paths;
}
void RifeRuntimeManager::prepare(const SourceInfo& source,quint64 itemGeneration){
    if(probing){emit prepared(itemGeneration,false,QStringLiteral("Runtime probe is still preparing"));return;}
    cancelActive();generation=itemGeneration;cacheHit=false;
    if(identityFor(source).isEmpty()){emit prepared(generation,false,QStringLiteral("Source or runtime is not eligible"));return;}
    if(!cachedEngine(source).isEmpty()){cacheHit=true;QTimer::singleShot(0,this,[this,itemGeneration,token=serial]{if(token==serial)emit prepared(itemGeneration,true,QString());});return;}
    compiling=true;const auto token=serial;emit preparationStarted(itemGeneration);
    // Direct signal handlers may cancel, select, or prepare a newer item.
    if(token!=serial)return;
    const QJsonObject request{{"runtime",root},{"cache",cache},{"model",modelId},{"width",source.width},{"height",source.height},{"deviceId",0},{"generation",qint64(itemGeneration)}};
    run("scripts/prepare_engine.py",request,false,[this,source,itemGeneration](bool ok,const QJsonObject& result,const QString& message){
        compiling=false;
        const bool ready=ok&&result["ready"].toBool()&&result["generation"].toInteger()==qint64(itemGeneration)&&!cachedEngine(source).isEmpty();
        error=ready?QString():message.isEmpty()?result["error"].toString("Engine preparation failed"):message;
        emit prepared(itemGeneration,ready,error);
    });
}
void RifeRuntimeManager::cancel(quint64 itemGeneration){if(itemGeneration==generation&&!probing)cancelActive();}
void RifeRuntimeManager::run(const QString& worker,const QJsonObject& request,bool probe,Finished finished){
    const auto folder=QSharedPointer<QTemporaryDir>::create(cache+"/prepare-XXXXXX");
    if(!folder->isValid()){finished(false,{},"Cannot create private preparation directory");return;}
    const auto resultPath=folder->path()+"/result.json",requestPath=folder->path()+"/request.json";
    cancellation=folder->path()+"/cancel";
    QStringList args{"-B","-I","-S","-X","utf8",privateFile(root,worker)};
    const bool nativeProbe=probe&&worker==manifest["entrypoints"].toObject()["worker"].toString();
    if(probe){args<<"--runtime"<<root;if(!nativeProbe)args<<"--report"<<resultPath;}
    else{
        auto payload=request;payload.insert("cancelFile",cancellation);QFile file(requestPath);
        if(!file.open(QIODevice::WriteOnly)||file.write(QJsonDocument(payload).toJson())<0){finished(false,{},"Cannot write preparation request");return;}
        file.close();args<<"--request"<<requestPath<<"--result"<<resultPath;
    }
    QProcessEnvironment env;for(const auto& key:{"SystemRoot","WINDIR","TEMP","TMP"})if(qEnvironmentVariableIsSet(key))env.insert(key,qEnvironmentVariable(key));
    env.insert("PATH",QDir(env.value("SystemRoot","C:/Windows")).filePath("System32"));
    env.insert("PYTHONNOUSERSITE","1");env.insert("PYTHONUTF8","1");
    if(nativeProbe)env.insert("VSSCRIPT_PATH",privateFile(root,manifest["entrypoints"].toObject()["vsscript"].toString()));
    const auto token=serial;auto* process=new QProcess(this);active=process;process->setWorkingDirectory(root);
    process->setCreateProcessArgumentsModifier([](auto* args){args->flags|=0x08000000;}); // CREATE_NO_WINDOW
    const auto done=QSharedPointer<bool>::create(false);
    auto complete=[this,process,token,folder,resultPath,finished,done,nativeProbe](bool ok,const QString& message){
        if(*done)return;*done=true;
        if(token==serial){active.clear();cancellation.clear();
            const auto result=nativeProbe?QJsonDocument::fromJson(process->readAllStandardOutput()).object():readObject(resultPath);
            finished(ok,result,message);}
        process->deleteLater();
    };
    connect(process,&QProcess::finished,this,[complete](int code,QProcess::ExitStatus status){complete(code==0&&status==QProcess::NormalExit,QString());});
    connect(process,&QProcess::errorOccurred,this,[complete,process](QProcess::ProcessError error){if(error==QProcess::FailedToStart)complete(false,process->errorString());});
    QTimer::singleShot(probe?75000:950000,process,[process,complete]{if(process->state()!=QProcess::NotRunning){process->kill();complete(false,"Preparation helper timed out");}});
    launch(process,privateFile(root,manifest["entrypoints"].toObject()["python"].toString()),args,env);
}
QVariantMap RifeRuntimeManager::diagnostics()const{return {{"runtimeReady",available},{"runtimePreparing",probing},{"enginePreparing",compiling},
    {"runtimeId",manifest["runtimeId"].toString()},{"model",modelId},{"targetFps",targetFps},{"cacheHit",cacheHit},{"gpu",gpu.toVariantMap()},{"error",error},{"generation",qulonglong(generation)}};}
}

#include "RifeExtensionManager.h"
#include "RifeExtensionDownload.h"
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLockFile>
#include <QRegularExpression>
#include <QSaveFile>
#include <QStorageInfo>
#include <QTemporaryDir>
#include <QUuid>

namespace rife {
namespace {
QString versionKey(const QJsonObject& item){return item["id"].toString()+"-"+item["version"].toString()+"-"+item["sha256"].toString().left(16);}
bool keyValid(const QString& key){static const QRegularExpression pattern("^[a-z0-9][a-z0-9-]{0,63}-[0-9]+\\.[0-9]+\\.[0-9]+-[0-9a-f]{16}$");return key.size()<=120&&pattern.match(key).hasMatch();}
bool plain(const QString& path) {
    QString current=QDir::cleanPath(QFileInfo(path).absoluteFilePath());
    for(;;){QFileInfo info(current);if(info.isSymLink()||info.isJunction())return false;const auto parent=info.absolutePath();if(parent==current)return true;current=parent;}
}
bool ensureRoot(const QString& root) {
    if(!plain(root)||!QDir().mkpath(root))return false;
    for(const auto& child:{"versions","leases","staging"})if(!plain(root+"/"+child)||!QDir().mkpath(root+"/"+child))return false;
    return true;
}
QJsonObject readRecord(const QString& path) {
    QFile file(path);if(!plain(path)||!file.open(QIODevice::ReadOnly)||file.size()>256*1024)return {};
    return QJsonDocument::fromJson(file.readAll()).object();
}
bool saveRecord(const QString& path,const QJsonObject& value) {
    if(!plain(path))return false;
    QSaveFile file(path);file.setDirectWriteFallback(false);
    const auto bytes=QJsonDocument(value).toJson();
    return file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit();
}
bool versionInUse(const QString& root,const QString& key) {
    const auto path=root+"/leases/"+key;
    if(!plain(path))return true;
    const QDir leases(path);
    for(const auto& name:leases.entryList(QDir::Files|QDir::Hidden|QDir::System)) {
        if(!name.endsWith(".lock")||!plain(path+"/"+name))return true;
        QLockFile lock(path+"/"+name);lock.setStaleLockTime(0);
        if(!lock.tryLock(0))return true;
        lock.unlock();
    }
    return false;
}
bool removeOwnedVersion(const QString& root,const QString& key) {
    if(!keyValid(key)||!plain(root+"/versions/"+key))return false;
    const auto parent=QFileInfo(root+"/versions").canonicalFilePath();
    const auto target=QFileInfo(root+"/versions/"+key).canonicalFilePath();
    if(target.isEmpty())return !QFileInfo::exists(root+"/versions/"+key);
    if(QFileInfo(target).absolutePath()!=parent)return false;
    // The resolved absolute directory is an immediate, validated child of our
    // versions directory. Qt removes symlinks as links rather than following them.
    return QDir(target).removeRecursively();
}
}

RifeExtensionManager::RifeExtensionManager(QString root,QJsonObject catalog,QString appVersion,QObject* parent)
    :QObject(parent),m_root(QDir::cleanPath(QFileInfo(root).absoluteFilePath())),m_appVersion(std::move(appVersion)),m_catalog(std::move(catalog))
{
    m_status={{"state","notInstalled"},{"busy",false},{"restartRequired",false}};
    QVariantList packages;
    for(const auto& value:m_catalog["packages"].toArray()) {
        const auto item=value.toObject();QString error;
        const auto validated=RifeExtensionArchive::catalogPackage(m_catalog,item["id"].toString(),m_appVersion,&error);
        if(error.isEmpty())packages.append(QVariantMap{{"id",validated["id"].toString()},{"version",validated["version"].toString()},
            {"downloadSize",validated["downloadSize"].toDouble()},{"unpackedSize",validated["unpackedSize"].toDouble()},{"downloadAvailable",!validated["url"].toString().isEmpty()}});
    }
    m_status["packages"]=packages;
}
RifeExtensionManager::~RifeExtensionManager(){cancel();if(m_worker)m_worker->wait();}
void RifeExtensionManager::publish(const QVariantMap& status){for(auto it=status.cbegin();it!=status.cend();++it)m_status[it.key()]=it.value();emit statusChanged(m_status);}
void RifeExtensionManager::cancel(){m_cancelled.store(true,std::memory_order_relaxed);}
void RifeExtensionManager::start(const QString& state,std::function<OperationResult()> work,bool startup) {
    Q_ASSERT(QThread::currentThread()==thread());
    if(m_worker){emit operationRejected("An extension operation is already running");return;}
    m_cancelled=false;
    auto result=std::make_shared<OperationResult>();
    auto* worker=QThread::create([result,work=std::move(work)]{*result=work();});
    m_worker=worker;worker->setParent(this);
    connect(worker,&QThread::finished,this,[this,worker,result,startup]{
        m_worker=nullptr;worker->deleteLater();
        if(startup){m_paths=result->paths;m_lease=result->lease;}
        auto finalStatus=result->ok?result->status:QVariantMap{{"state",m_cancelled?"cancelled":"error"},{"error",result->error}};
        finalStatus["busy"]=false;
        publish(finalStatus); // A direct slot may start the next operation here.
        // No state writes after the final publish: reentrant work owns it now.
        emit operationFinished(result->ok,result->error);
    });
    publish({{"state",state},{"busy",true},{"error",""},{"doneBytes",0}});
    worker->start();
}
RifeExtensionArchive::Options RifeExtensionManager::archiveOptions() {
    RifeExtensionArchive::Options options;options.cancelled=&m_cancelled;
    if(m_availableBytes>=0)options.availableBytes=[n=m_availableBytes](const QString&){return n;};
    options.progress=[this](qint64 done,qint64 total){QMetaObject::invokeMethod(this,[this,done,total]{if(m_worker)publish({{"doneBytes",done},{"totalBytes",total}});},Qt::QueuedConnection);};
    return options;
}
void RifeExtensionManager::initialize(){
    if(m_lease){emit operationFinished(false,"Runtime is already in use; restart before changing it");return;}
    start("checking",[this]{return loadActive();},true);
}
void RifeExtensionManager::importPackage(const QString& path){start("installing",[this,path]{return install(path);});}
void RifeExtensionManager::download(const QString& id){start("downloading",[this,id]{
    OperationResult result;QString error;
    const auto item=RifeExtensionArchive::catalogPackage(m_catalog,id,m_appVersion,&error);
    if(!error.isEmpty()){result.error=error;return result;}
    if(!ensureRoot(m_root)){result.error="Cannot create private extension root";return result;}
    const auto path=RifeExtensionDownload::fetch(item,m_root+"/downloads",archiveOptions(),m_testCertificate,&error);
    if(path.isEmpty()){result.error=error;return result;}
    QMetaObject::invokeMethod(this,[this]{publish({{"state","installing"},{"doneBytes",0}});},Qt::QueuedConnection);
    return install(path);
});}
void RifeExtensionManager::scheduleRemoval(const QString& key){start("removing",[this,key]{return removeVersion(key);});}

RifeExtensionManager::OperationResult RifeExtensionManager::install(const QString& path) {
    OperationResult result;auto fail=[&](const QString& text){result.error=text;return result;};
    if(!ensureRoot(m_root))return fail("Cannot create private extension root");
    QLockFile lock(m_root+"/install.lock");lock.setStaleLockTime(0);
    if(!plain(lock.fileName())||!lock.tryLock(0))return fail("Another process is managing the extension");
    if(m_cancelled)return fail("Extension operation cancelled");
    QFile archive(path);if(!archive.open(QIODevice::ReadOnly))return fail("Cannot read extension package");
    QCryptographicHash digest(QCryptographicHash::Sha256);
    while(!archive.atEnd()){if(m_cancelled)return fail("Extension operation cancelled");const auto bytes=archive.read(1024*1024);if(bytes.isEmpty())return fail("Cannot hash extension package");digest.addData(bytes);}
    const auto hash=QString::fromLatin1(digest.result().toHex());QJsonObject item;int matches=0;
    for(const auto& value:m_catalog["packages"].toArray()) {
        const auto candidate=value.toObject();QString error;
        if(candidate["sha256"]==hash&&candidate["downloadSize"].toDouble()==archive.size()) {
            const auto validated=RifeExtensionArchive::catalogPackage(m_catalog,candidate["id"].toString(),m_appVersion,&error);
            if(!error.isEmpty())return fail(error);
            item=validated;++matches;
        }
    }
    if(matches!=1)return fail("Extension package is not uniquely listed in the trusted catalog");
    const auto freeBytes=m_availableBytes>=0?m_availableBytes:QStorageInfo(m_root).bytesAvailable();
    if(freeBytes<item["unpackedSize"].toDouble()+256*1024*1024)return fail("Insufficient disk space for extension staging");
    const auto key=versionKey(item);if(!keyValid(key))return fail("Invalid installed version key");
    const auto destination=m_root+"/versions/"+key;
    auto options=archiveOptions();
    if(QFileInfo::exists(destination)) {
        const auto verified=RifeExtensionArchive::verifyInstalled(destination,item,options);
        if(!verified.ok)return fail(verified.error);
    } else {
        QTemporaryDir stage(m_root+"/staging/install-XXXXXX");if(!stage.isValid())return fail("Cannot create extension staging directory");
        const auto extracted=RifeExtensionArchive::extract(path,item,stage.path(),options);
        if(!extracted.ok)return fail(extracted.error);
        for(const auto& required:{"runtime/runtime.json","playback/interpolate_trt.vpy","playback/trt_pipeline.py","playback/tigerest-rife-vs.dll"})if(!QFileInfo(stage.path()+"/"+required).isFile())return fail("Missing required extension payload");
        if(m_cancelled)return fail("Extension operation cancelled");
        if(!plain(destination)||!QDir().rename(stage.path(),destination))return fail("Cannot atomically publish extension version");
        stage.setAutoRemove(false);
    }
    if(m_cancelled)return fail("Extension operation cancelled");
    // Reinstallation revokes an earlier scheduled removal before activating.
    // Startup also protects the active key if an earlier process was interrupted.
    const auto pendingRecord=readRecord(m_root+"/pending-removals.json");
    const auto oldPending=pendingRecord["versions"].toArray();QJsonArray pending;
    for(const auto& value:oldPending)if(value.toString()!=key)pending.append(value);
    if(pending!=oldPending&&!saveRecord(m_root+"/pending-removals.json",{{"schemaVersion",1},{"versions",pending}}))return fail("Cannot revoke scheduled extension removal");
    if(m_cancelled)return fail("Extension operation cancelled");
    const QJsonObject record{{"schemaVersion",1},{"id",item["id"]},{"sha256",item["sha256"]},{"versionKey",key}};
    if(!saveRecord(m_root+"/active.json",record))return fail("Cannot atomically activate extension");
    result.ok=true;result.status={{"state","restartRequired"},{"restartRequired",true},{"removalPending",false},{"installedVersion",key},{"error",""}};return result;
}

RifeExtensionManager::OperationResult RifeExtensionManager::loadActive() {
    OperationResult result;auto fail=[&](const QString& text){result.error=text;return result;};
    if(!ensureRoot(m_root))return fail("Cannot create private extension root");
    QLockFile lock(m_root+"/install.lock");lock.setStaleLockTime(0);
    if(!plain(lock.fileName())||!lock.tryLock(0))return fail("Another process is managing the extension");
    if(m_cancelled)return fail("Extension operation cancelled");
    const auto activeBeforeCleanup=readRecord(m_root+"/active.json");
    const auto pending=readRecord(m_root+"/pending-removals.json");QJsonArray retained;
    for(const auto& value:pending["versions"].toArray()) {
        if(m_cancelled)return fail("Extension operation cancelled");
        const auto key=value.toString();
        if(!keyValid(key))return fail("Invalid pending installed version");
        if(key==activeBeforeCleanup["versionKey"].toString())continue;
        bool known=false;
        for(const auto& item:m_catalog["packages"].toArray())if(versionKey(item.toObject())==key)known=true;
        if(!known){retained.append(key);continue;}
        if(versionInUse(m_root,key)||!removeOwnedVersion(m_root,key))retained.append(key);
    }
    if(!pending.isEmpty()&&!saveRecord(m_root+"/pending-removals.json",{{"schemaVersion",1},{"versions",retained}}))return fail("Cannot update pending removals");
    if(!QFileInfo::exists(m_root+"/active.json")){result.ok=true;result.status={{"state","notInstalled"},{"restartRequired",false}};return result;}
    const auto active=readRecord(m_root+"/active.json");QString error;
    const auto item=RifeExtensionArchive::catalogPackage(m_catalog,active["id"].toString(),m_appVersion,&error);
    if(!error.isEmpty())return fail(error);
    const auto key=versionKey(item);
    if(active["schemaVersion"]!=1||active["sha256"]!=item["sha256"]||active["versionKey"]!=key||!keyValid(key))return fail("Active extension record differs from trusted catalog");
    const auto root=m_root+"/versions/"+key;
    const auto verified=RifeExtensionArchive::verifyInstalled(root,item,archiveOptions());if(!verified.ok)return fail(verified.error);
    if(m_cancelled)return fail("Extension operation cancelled");
    const auto leaseDirectory=m_root+"/leases/"+key;
    if(!plain(leaseDirectory)||!QDir().mkpath(leaseDirectory))return fail("Cannot create extension use lease");
    auto lease=std::make_shared<QLockFile>(leaseDirectory+"/"+QUuid::createUuid().toString(QUuid::Id128)+".lock");lease->setStaleLockTime(0);
    if(!lease->tryLock(0))return fail("Cannot acquire extension use lease");
    result.lease=lease;result.paths={{"runtime",root+"/runtime"},{"monitor",root+"/playback/tigerest-rife-vs.dll"},{"script",root+"/playback/interpolate_trt.vpy"},{"versionKey",key}};
    result.ok=true;result.status={{"state","ready"},{"restartRequired",false},{"installedVersion",key},{"error",""}};return result;
}

RifeExtensionManager::OperationResult RifeExtensionManager::removeVersion(const QString& key) {
    OperationResult result;auto fail=[&](const QString& text){result.error=text;return result;};
    if(!keyValid(key)||!ensureRoot(m_root))return fail("Invalid installed version for removal");
    bool listed=false;
    for(const auto& value:m_catalog["packages"].toArray())if(versionKey(value.toObject())==key)listed=true;
    if(!listed||!QFileInfo(m_root+"/versions/"+key).isDir()||!plain(m_root+"/versions/"+key))return fail("Unknown installed version for removal");
    QLockFile lock(m_root+"/install.lock");lock.setStaleLockTime(0);
    if(!plain(lock.fileName())||!lock.tryLock(0))return fail("Another process is managing the extension");
    if(m_cancelled)return fail("Extension operation cancelled");
    auto pending=readRecord(m_root+"/pending-removals.json")["versions"].toArray();
    if(!pending.contains(key))pending.append(key);
    if(!saveRecord(m_root+"/pending-removals.json",{{"schemaVersion",1},{"versions",pending}}))return fail("Cannot schedule extension removal");
    const auto active=readRecord(m_root+"/active.json");
    if(active["versionKey"]==key&&(!plain(m_root+"/active.json")||!QFile::remove(m_root+"/active.json")))return fail("Cannot deactivate extension for removal");
    const auto inUse=versionInUse(m_root,key);
    if(!inUse&&!removeOwnedVersion(m_root,key))return fail("Cannot remove installed extension version");
    result.ok=true;result.status={{"state","restartRequired"},{"restartRequired",true},{"removalPending",inUse},{"error",""}};return result;
}
}

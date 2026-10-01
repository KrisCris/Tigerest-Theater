#include "RifeExtensionDownload.h"
#include <QCryptographicHash>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QLockFile>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSslCertificate>
#include <QSslConfiguration>
#include <QStorageInfo>
#include <QTimer>
#include <QUrl>

namespace rife {
namespace {
bool plain(const QString& path) {
    QString current=QFileInfo(path).absoluteFilePath();
    for(;;){QFileInfo info(current);if(info.isSymLink()||info.isJunction())return false;const auto parent=info.absolutePath();if(parent==current)return true;current=parent;}
}
bool isCancelled(const RifeExtensionArchive::Options& options){return options.cancelled&&options.cancelled->load(std::memory_order_relaxed);}
bool strongEtag(const QByteArray& value) {
    if(value.size()<2||value.size()>512||!value.startsWith('"')||!value.endsWith('"'))return false;
    for(qsizetype i=1;i<value.size()-1;++i)if(static_cast<unsigned char>(value[i])<33||value[i]=='"'||static_cast<unsigned char>(value[i])==127)return false;
    return true;
}
QJsonObject readMeta(const QString& path) {
    QFile file(path);if(!file.open(QIODevice::ReadOnly)||file.size()>16*1024)return {};
    return QJsonDocument::fromJson(file.readAll()).object();
}
bool saveMeta(const QString& path,const QJsonObject& value) {
    QSaveFile file(path);file.setDirectWriteFallback(false);const auto bytes=QJsonDocument(value).toJson();
    return file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit();
}
QString fileHash(QFile& file,const RifeExtensionArchive::Options& options) {
    if(!file.seek(0))return {};
    QCryptographicHash digest(QCryptographicHash::Sha256);
    while(!file.atEnd()){if(isCancelled(options))return {};const auto bytes=file.read(1024*1024);if(bytes.isEmpty())return {};digest.addData(bytes);if(options.progress)options.progress(file.pos(),file.size());}
    if(isCancelled(options))return {};
    return QString::fromLatin1(digest.result().toHex());
}
}
QString RifeExtensionDownload::fetch(const QJsonObject& item,const QString& root,
    const RifeExtensionArchive::Options& options,const QByteArray& testCertificate,QString* error)
{
    auto fail=[&](const QString& message){if(error)*error=message;return QString{};};
    if(error)error->clear();
    const QUrl url(item["url"].toString());
    if(!url.isValid()||url.scheme()!="https"||url.host().isEmpty()||!url.userInfo().isEmpty()||url.hasFragment())return fail("Extension download is not available from a fixed HTTPS URL");
    const auto hash=item["sha256"].toString();
    static const QRegularExpression hashPattern("^[0-9a-f]{64}$");
    const auto size=item["downloadSize"].toInteger();
    if(!hashPattern.match(hash).hasMatch()||size<=0)return fail("Invalid trusted download size/hash");
    if(!plain(root)||!QDir().mkpath(root))return fail("Cannot create private download directory");
    const auto path=root+"/"+hash+".zip.part",metaPath=root+"/"+hash+".json";
    if(!plain(path)||!plain(metaPath)||!plain(root+"/download.lock"))return fail("Download cache links are forbidden");
    QLockFile lock(root+"/download.lock");lock.setStaleLockTime(0);
    if(!lock.tryLock(0))return fail("Another process is downloading the extension");
    if(isCancelled(options))return fail("Extension operation cancelled");
    QFile file(path);if(!file.open(QIODevice::ReadWrite))return fail("Cannot write extension download");
    if(file.size()==size) {
        const auto cachedHash=fileHash(file,options);
        if(isCancelled(options))return fail("Extension operation cancelled");
        if(file.error()!=QFile::NoError)return fail("Cannot hash cached extension download");
        if(cachedHash==hash)return path;
    }
    auto meta=readMeta(metaPath);auto etag=meta["etag"].toString().toLatin1();
    bool resumable=meta["schemaVersion"]==1&&meta["url"]==url.toString()&&meta["sha256"]==hash
        &&meta["size"].toInteger()==size&&strongEtag(etag)&&file.size()>0&&file.size()<size;
    if(!resumable){if(!file.resize(0))return fail("Cannot reset extension download");etag.clear();}
    const auto freeBytes=options.availableBytes?options.availableBytes(root):QStorageInfo(root).bytesAvailable();
    if(freeBytes<size-file.size()+item["unpackedSize"].toDouble()+256*1024*1024)return fail("Insufficient disk space for extension download and staging");
    // Created on this worker thread, with no Emby connection, cookie jar or auth.
    QNetworkAccessManager network;
    for(int attempt=0;attempt<2;++attempt) {
        if(isCancelled(options))return fail("Extension operation cancelled");
        const auto requestedOffset=resumable?file.size():0;
        if(!file.seek(requestedOffset))return fail("Cannot seek extension download");
        QNetworkRequest request(url);
        request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::NoLessSafeRedirectPolicy);
        request.setRawHeader("Accept-Encoding","identity");request.setTransferTimeout(30000);
        if(!testCertificate.isEmpty()) {
            auto configuration=QSslConfiguration::defaultConfiguration();
            auto authorities=configuration.caCertificates();authorities.append(QSslCertificate::fromData(testCertificate));
            configuration.setCaCertificates(authorities);request.setSslConfiguration(configuration);
        }
        if(requestedOffset>0){request.setRawHeader("Range","bytes="+QByteArray::number(requestedOffset)+"-");request.setRawHeader("If-Range",etag);}
        auto* reply=network.get(request);
        QEventLoop loop;QTimer cancelTimer;cancelTimer.setInterval(25);
        bool accepted=false,retryFresh=false;QString failure;
        auto abort=[&](const QString& reason){failure=reason;reply->abort();};
        auto headers=[&] {
            if(accepted||!failure.isEmpty()||!reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).isValid())return;
            const auto status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            if(status>=300&&status<400)return; // QNetworkAccessManager follows HTTPS redirects.
            const auto responseEtag=reply->rawHeader("ETag");
            if(status==206) {
                const auto expected="bytes "+QByteArray::number(requestedOffset)+"-"+QByteArray::number(size-1)+"/"+QByteArray::number(size);
                if(requestedOffset<=0||reply->rawHeader("Content-Range")!=expected||responseEtag!=etag||!strongEtag(responseEtag)) {
                    retryFresh=requestedOffset>0&&attempt==0;abort("Range or ETag changed; partial response rejected");return;
                }
            } else if(status==200) {
                if(!file.resize(0)||!file.seek(0)){abort("Cannot reset extension download");return;}
            } else {abort("Extension download HTTP status "+QString::number(status));return;}
            const auto contentLength=reply->header(QNetworkRequest::ContentLengthHeader);
            const auto wanted=status==206?size-requestedOffset:size;
            if(contentLength.isValid()&&contentLength.toLongLong()!=wanted){abort("Download content length differs from catalog");return;}
            const auto encoding=reply->rawHeader("Content-Encoding");
            if(!encoding.isEmpty()&&encoding!="identity"){abort("Unsupported download content encoding");return;}
            const QJsonObject record{{"schemaVersion",1},{"url",url.toString()},{"sha256",hash},{"size",size},
                {"etag",strongEtag(responseEtag)?QString::fromLatin1(responseEtag):QString{}}};
            if(!saveMeta(metaPath,record)){abort("Cannot commit extension resume metadata");return;}
            accepted=true;
        };
        auto consume=[&] {
            headers();if(!accepted||!failure.isEmpty())return;
            while(reply->bytesAvailable()>0) {
                if(isCancelled(options)){abort("Extension operation cancelled");return;}
                const auto bytes=reply->read(1024*1024);
                if(bytes.size()>size-file.pos()){abort("Download exceeds trusted catalog size");return;}
                if(file.write(bytes)!=bytes.size()){abort("Cannot write extension download");return;}
                if(options.progress)options.progress(file.pos(),size);
            }
        };
        QObject::connect(reply,&QNetworkReply::metaDataChanged,&loop,headers);
        QObject::connect(reply,&QIODevice::readyRead,&loop,consume);
        QObject::connect(reply,&QNetworkReply::finished,&loop,&QEventLoop::quit);
        QObject::connect(&cancelTimer,&QTimer::timeout,&loop,[&]{if(isCancelled(options))abort("Extension operation cancelled");});
        cancelTimer.start();loop.exec();cancelTimer.stop();consume();
        const auto networkError=reply->error();const auto networkText=reply->errorString();
        delete reply;
        if(!file.flush())return fail("Cannot flush extension download");
        if(isCancelled(options))return fail("Extension operation cancelled");
        if(retryFresh){if(!file.resize(0)||!file.seek(0))return fail("Cannot reset extension download");resumable=false;etag.clear();continue;}
        if(!failure.isEmpty())return fail(failure);
        if(networkError!=QNetworkReply::NoError)return fail("Extension download failed: "+networkText);
        if(!accepted||file.size()!=size)return fail("Incomplete extension download");
        if(fileHash(file,options)!=hash)return fail(isCancelled(options)?"Extension operation cancelled":"Downloaded archive hash differs from trusted catalog");
        return path;
    }
    return fail("Extension download could not restart safely");
}
}

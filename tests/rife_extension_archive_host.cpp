#include "windows/RifeExtensionArchive.h"
#include <QCoreApplication>
#include <QFile>
#include <QJsonDocument>
#include <cstdio>

int main(int argc,char** argv)
{
    QCoreApplication app(argc,argv);
    const auto args=app.arguments();
    if(args.size()!=8)return 3;
    QFile catalog(args[2]);
    if(!catalog.open(QIODevice::ReadOnly))return 3;
    QString error;
    const auto item=rife::RifeExtensionArchive::catalogPackage(
        QJsonDocument::fromJson(catalog.readAll()).object(),args[3],args[4],&error);
    rife::RifeExtensionArchive::Result result;
    if(!error.isEmpty())result.error=error;
    else {
        std::atomic_bool cancelled{false};
        rife::RifeExtensionArchive::Options options;
        options.cancelled=&cancelled;
        if(args[6]!="default")options.availableBytes=[n=args[6].toLongLong()](const QString&){return n;};
        const auto cancelAfter=args[7].toLongLong();
        options.progress=[&](qint64 done,qint64){if(cancelAfter>=0&&done>=cancelAfter)cancelled=true;};
        result=rife::RifeExtensionArchive::extract(args[1],item,args[5],options);
    }
    const auto bytes=QJsonDocument(QJsonObject{{"ok",result.ok},{"error",result.error},{"manifest",result.manifest}}).toJson(QJsonDocument::Compact);
    fwrite(bytes.constData(),1,static_cast<size_t>(bytes.size()),stdout);
    return result.ok?0:2;
}

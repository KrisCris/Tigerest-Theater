#include "windows/RifeExtensionManager.h"
#include "windows/RifeExtensionDownload.h"
#include "windows/RifeGpuArchitecture.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QDirIterator>
#include <QJsonDocument>
#include <QJsonArray>
#include <QThread>
#include <cstdio>

int main(int argc,char** argv) {
    QCoreApplication app(argc,argv);const auto args=app.arguments();
    if(args.size()!=7)return 3;
    QFile catalogFile(args[2]);if(!catalogFile.open(QIODevice::ReadOnly))return 3;
    const auto trustedCatalog=QJsonDocument::fromJson(catalogFile.readAll()).object();
    std::function<QString()> gpuReportProvider;
    if(trustedCatalog.contains("testGpuReport"))gpuReportProvider=[report=trustedCatalog["testGpuReport"].toString()]{return report;};
    rife::RifeExtensionManager manager(args[3],trustedCatalog,args[4],nullptr,std::move(gpuReportProvider));
    if(args[1]=="packageSelection") {
        catalogFile.seek(0);const auto catalog=QJsonDocument::fromJson(catalogFile.readAll()).object();
        const auto bytes=QJsonDocument::fromVariant(rife::RifeExtensionManager::packageSelection(
            catalog,args[4],catalog["testGpuCount"].toInt(),catalog["testGpuMajor"].toInt(),catalog["testGpuMinor"].toInt())).toJson(QJsonDocument::Compact);
        fwrite(bytes.constData(),1,static_cast<size_t>(bytes.size()),stdout);return 0;
    }
    if(args[1]=="parseGpuReport") {
        catalogFile.seek(0);const auto catalog=QJsonDocument::fromJson(catalogFile.readAll()).object();
        const auto bytes=QJsonDocument(QJsonObject{{"architecture",rife::gpuPackageArchitectureFromReport(
            catalog["testGpuReport"].toString())}}).toJson(QJsonDocument::Compact);
        fwrite(bytes.constData(),1,static_cast<size_t>(bytes.size()),stdout);return 0;
    }
    if(args[1]=="verifyCacheCancel") {
        catalogFile.seek(0);const auto item=QJsonDocument::fromJson(catalogFile.readAll()).object()["packages"].toArray()[0].toObject();
        std::atomic_bool cancelled{false};rife::RifeExtensionArchive::Options options;options.cancelled=&cancelled;
        options.progress=[&](qint64 done,qint64){if(done>0)cancelled=true;};
        QString error;const auto path=rife::RifeExtensionDownload::fetch(item,args[3]+"/downloads",options,{},&error);
        const auto bytes=QJsonDocument(QJsonObject{{"ok",!path.isEmpty()},{"error",error}}).toJson(QJsonDocument::Compact);
        fwrite(bytes.constData(),1,static_cast<size_t>(bytes.size()),stdout);return 0;
    }
    bool done=false,ok=false;QString error;int completions=0;
    const int wanted=args[6]=="reenter"?2:1;
    QObject::connect(&manager,&rife::RifeExtensionManager::operationFinished,[&](bool success,const QString& text){done=++completions>=wanted;ok=success;error=text;});
    bool reentered=false,busyLost=false;int rejections=0;
    QObject::connect(&manager,&rife::RifeExtensionManager::operationRejected,[&](const QString& text){
        ++rejections;if(args[6]=="doubleInitialize"){done=true;ok=false;error=text;}
    });
    // Count rejected concurrent requests separately from the active operation.
    if(args[6]=="duplicate")QObject::connect(&manager,&rife::RifeExtensionManager::statusChanged,[&](const QVariantMap& s){
        if(s["busy"].toBool()&&!reentered){reentered=true;manager.importPackage(args[1]);}
    });
    if(args[6]=="reenter")QObject::connect(&manager,&rife::RifeExtensionManager::statusChanged,[&](const QVariantMap& s){
        if(s["state"]=="installing"&&!s["busy"].toBool())busyLost=true;
        if(s["state"]=="restartRequired"&&!reentered){reentered=true;manager.importPackage(args[1]);}
    });
    if(args[5]!="default")manager.setAvailableBytesForTest(args[5].toLongLong());
    if(args[1]=="download") {
        QFile optionsFile(args[6]);if(!optionsFile.open(QIODevice::ReadOnly))return 3;
        const auto options=QJsonDocument::fromJson(optionsFile.readAll()).object();
        QFile ca(options["ca"].toString());if(!ca.open(QIODevice::ReadOnly))return 3;
        if(options["trustTestCa"].toBool(true))manager.setTrustedCertificateForTest(ca.readAll());
        const auto cancelAt=options["cancelAt"].toDouble(-1);
        if(cancelAt>=0)QObject::connect(&manager,&rife::RifeExtensionManager::statusChanged,[&,cancelAt](const QVariantMap& status){if(status["state"]=="downloading"&&status["doneBytes"].toLongLong()>=cancelAt)manager.cancel();});
    }
    if(args[6]=="cancel")QObject::connect(&manager,&rife::RifeExtensionManager::statusChanged,[&](const QVariantMap& s){if(s["state"]=="installing"||s["state"]=="checking")manager.cancel();});
    if(args[1]=="download")manager.download("rife-test-win64");
    else if(args[1]=="initialize")manager.initialize();
    else if(args[1]=="remove")manager.scheduleRemoval(args[6]);
    else manager.importPackage(args[1]);
    QElapsedTimer timer;timer.start();
    const int budget=args[6]=="fullPackage"?180000:15000;
    while(!done&&timer.elapsed()<budget){QCoreApplication::processEvents();QThread::msleep(1);}
    if(!done)return 4;
    QVariantMap result{{"ok",ok},{"error",error},{"status",manager.status()},{"paths",manager.runtimePaths()},{"busyLostWhileInstalling",busyLost},{"completions",completions},{"rejections",rejections}};
    QDirIterator leases(args[3]+"/leases",{"*.lock"},QDir::Files,QDirIterator::Subdirectories);
    int leaseCount=0;while(leases.hasNext()){leases.next();++leaseCount;}
    result["leaseCount"]=leaseCount;
    if(args[6]=="corruptRemove") {
        done=false;manager.scheduleRemoval(manager.status()["installedVersion"].toString());
        timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
        result["removalOk"]=ok;result["removalStatus"]=manager.status();
    }
    if(args[6]=="busyInitialize") {
        done=false;const int before=completions;bool triggered=false;
        QObject::connect(&manager,&rife::RifeExtensionManager::statusChanged,[&](const QVariantMap& s){
            if(s["state"]=="installing"&&s["busy"].toBool()&&!triggered){triggered=true;manager.initialize();}
        });
        catalogFile.seek(0);const auto catalog=QJsonDocument::fromJson(catalogFile.readAll()).object();
        manager.importPackage(catalog["testArchive"].toString());
        timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
        result["secondOk"]=ok;result["secondError"]=error;result["secondCompletions"]=completions-before;
        result["secondPaths"]=manager.runtimePaths();result["rejections"]=rejections;
    }
    if(args[6]=="doubleInitialize") {
        done=false;manager.initialize();
        timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
        result["secondOk"]=ok;result["secondError"]=error;result["secondPaths"]=manager.runtimePaths();
    }
    if(args[6]=="lease"||args[6]=="reinstall") {
        // Catalog is reopened rather than fabricated in the second process-like owner.
        catalogFile.seek(0);
        rife::RifeExtensionManager owner(args[3],QJsonDocument::fromJson(catalogFile.readAll()).object(),args[4]);
        done=false;QObject::connect(&owner,&rife::RifeExtensionManager::operationFinished,[&](bool success,const QString&){done=true;ok=success;});
        owner.initialize();
        timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
        result["secondPaths"]=owner.runtimePaths();
        done=false;manager.scheduleRemoval(owner.runtimePaths()["versionKey"].toString());
        timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
        result["removalStatus"]=manager.status();
        result["heldRuntimeExists"]=QFile::exists(owner.runtimePaths()["runtime"].toString()+"/runtime.json");
        if(args[6]=="reinstall") {
            catalogFile.seek(0);const auto catalog=QJsonDocument::fromJson(catalogFile.readAll()).object();
            done=false;manager.importPackage(catalog["testArchive"].toString());
            timer.restart();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}
            result["reinstallOk"]=ok;result["reinstallError"]=error;
        }
    }
    const auto bytes=QJsonDocument::fromVariant(result).toJson(QJsonDocument::Compact);
    fwrite(bytes.constData(),1,static_cast<size_t>(bytes.size()),stdout);
    if(args[6]=="hold"){fputc('\n',stdout);fflush(stdout);fgetc(stdin);}
    return 0;
}

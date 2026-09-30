#ifdef NDEBUG
#undef NDEBUG
#endif
#include "windows/RifeRuntimeManager.h"
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QTemporaryDir>
#include <QThread>
#include <cassert>
using namespace rife;
static void write(const QString& path,const QByteArray& bytes){QFile f(path);assert(f.open(QIODevice::WriteOnly));assert(f.write(bytes)==bytes.size());}
static void json(const QString& path,const QJsonObject& value){write(path,QJsonDocument(value).toJson());}
static bool until(const std::function<bool()>& predicate){QElapsedTimer t;t.start();while(!predicate()&&t.elapsed()<5000){QCoreApplication::processEvents();QThread::msleep(10);}return predicate();}
int main(int argc,char**argv){
    QCoreApplication app(argc,argv);
    QTemporaryDir temp;assert(temp.isValid());
    const auto root=temp.path()+"/中文 私有运行库";const auto cache=temp.path()+"/引擎 缓存";
    QDir().mkpath(root+"/python");QDir().mkpath(root+"/scripts");QDir().mkpath(root+"/plugins");
    write(root+"/monitor.dll","host monitor fixture");write(root+"/interpolate.vpy","host script fixture");
    QJsonArray files;
    for(const QString path:{"python/python.exe","scripts/probe_runtime.py","scripts/prepare_engine.py","plugins/model.onnx","plugins/vstrt.dll"}){
        const QByteArray bytes="Qt lifecycle fixture";write(root+"/"+path,bytes);
        files.append(QJsonObject{{"path",path},{"size",bytes.size()},{"sha256",QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())}});
    }
    const auto model=QJsonObject{{"id","rife-4.25-lite"},{"path","plugins/model.onnx"},{"sha256",files[3].toObject()["sha256"]},{"alignment",1},{"implementation",2}};
    json(root+"/runtime.json",{{"schemaVersion",1},{"backend","windows-nvidia-trt"},{"runtimeId","fixture-v2"},{"versions",QJsonObject{{"tensorrt","10.16"}}},
        {"files",files},{"models",QJsonArray{model}},{"entrypoints",QJsonObject{{"python","python/python.exe"},{"plugin","plugins/vstrt.dll"}}}});
    const auto gpu=QJsonObject{{"name","Fixture NVIDIA"},{"computeCapability","8.9"},{"uuid",QString(32,'3')},{"driverVersion","616.64"},{"cudaDriverVersion",13040},{"deviceId",0}};
    json(root+"/fixture.json",{{"probe",QJsonObject{{"ok",true},{"privateLibrariesOnly",true},{"gpu",gpu}}},{"delay",20}});
    bool isolated=false;int launches=0;
    auto launch=[&](QProcess* process,const QString& program,const QStringList& arguments,const QProcessEnvironment& env){
        ++launches;
        assert(program==root+"/python/python.exe");
        assert(arguments.mid(0,5)==QStringList({"-B","-I","-S","-X","utf8"}));
        assert(!env.contains("PYTHONHOME")&&!env.contains("PYTHONPATH"));isolated=true;
        // The fake interpreter is test-only; production always uses program/env.
        process->setProgram(QStringLiteral(RIFE_HOST_TEST_PYTHON));
        process->setArguments(QStringList{"-B","-I","-S","-X","utf8",QStringLiteral(RIFE_MANAGER_WORKER_FIXTURE)}+arguments.mid(6));
        process->start();
    };
    RifeRuntimeManager manager(nullptr,launch);
    QList<quint64> ready;
    QObject::connect(&manager,&RifeRuntimeManager::prepared,[&](quint64 generation,bool ok,const QString&){if(ok)ready<<generation;});
    assert(manager.configure(root,cache,root+"/monitor.dll",root+"/interpolate.vpy"));
    assert(until([&]{return manager.diagnostics()["runtimeReady"].toBool();}));assert(isolated);
    const SourceInfo a{256,128,24,1,true,true,false,true},b{240,112,24,1,true,true,false,true};
    assert(manager.pathsFor(a).engine.isEmpty());
    manager.prepare(a,10);manager.cancel(10);manager.prepare(b,11);
    assert(until([&]{return ready.contains(11);}));assert(!ready.contains(10));
    assert(manager.pathsFor(a).engine.isEmpty());
    const auto paths=manager.pathsFor(b);assert(paths.available&&!paths.engine.isEmpty());
    assert(paths.backend==Backend::TensorRT&&paths.implementation==2&&paths.factor==2);
    assert(manager.select("rife-4.25-lite",240));assert(manager.pathsFor(b).factor==10);
    assert(!manager.select("unlisted-model",240));
    const int previous=ready.size();manager.prepare(b,12);assert(until([&]{return ready.size()>previous;}));assert(ready.last()==12);
    manager.prepare(b,14);manager.cancel(14);QCoreApplication::processEvents();assert(!ready.contains(14));
    manager.prepare(b,15);assert(manager.select("rife-4.25-lite",120));QCoreApplication::processEvents();assert(!ready.contains(15));
    const int launchesBeforeCancellation=launches;
    const auto connection=QObject::connect(&manager,&RifeRuntimeManager::preparationStarted,[&](quint64 gen){manager.cancel(gen);});
    manager.prepare(a,16);assert(launches==launchesBeforeCancellation);
    QObject::disconnect(connection);QCoreApplication::processEvents();assert(!ready.contains(16));
    // Keep the size identical so the content digest must reject corruption.
    const auto engineSize=QFileInfo(paths.engine).size();write(paths.engine,QByteArray(engineSize,'!'));assert(manager.pathsFor(b).engine.isEmpty());
    auto hdr=b;hdr.hdr=true;manager.prepare(hdr,13);QCoreApplication::processEvents();assert(!ready.contains(13));
    assert(!manager.configure(root+"/missing",cache,root+"/monitor.dll",root+"/interpolate.vpy"));
    assert(!manager.pathsFor(b).available);
    // Opt-in real private process and cross-language cache identity. No engine
    // compilation is allowed by this test: it must find the prepared fixture.
    if(qEnvironmentVariableIsSet("RIFE_TEST_RUNTIME")&&qEnvironmentVariableIsSet("RIFE_TEST_ENGINE_PATH")){
        const auto repo=QDir(QFileInfo(QStringLiteral(RIFE_MANAGER_WORKER_FIXTURE)).absolutePath()+"/..").absolutePath();
        const auto engine=qEnvironmentVariable("RIFE_TEST_ENGINE_PATH");
        const auto realCache=QFileInfo(QFileInfo(engine).absolutePath()).absolutePath();
        RifeRuntimeManager real;
        assert(real.configure(qEnvironmentVariable("RIFE_TEST_RUNTIME"),realCache,
            repo+"/build/src/player/interpolation/tigerest-rife-vs.dll",repo+"/resources/mpv/rife/interpolate_trt.vpy"));
        assert(until([&]{return real.diagnostics()["runtimeReady"].toBool();}));
        assert(real.pathsFor(a).engine==QFileInfo(engine).canonicalFilePath());
        bool hit=false;QObject::connect(&real,&RifeRuntimeManager::prepared,[&](quint64 gen,bool ok,const QString&){hit=gen==44&&ok;});
        real.prepare(a,44);assert(until([&]{return hit;}));assert(real.diagnostics()["cacheHit"].toBool());
    }
}

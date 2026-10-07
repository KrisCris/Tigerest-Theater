#include <QApplication>
#include <QCommandLineParser>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QSaveFile>
#include <QScreen>
#include <QTemporaryDir>
#include <QFileInfo>
#include <QThread>
#include <MpvController>
#include <windows.h>
#include <dbghelp.h>
#include <cstdio>
#include "Paths.h"
#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "player/MpvVideoItem.h"
#include "player/MpvConfigManager.h"
#include "settings/SettingsComponent.h"
#include "input/InputComponent.h"
#include <cmath>

static FILE* evidence=nullptr;
static void message(QtMsgType,const QMessageLogContext&,const QString& text){
    if(evidence){const auto bytes=text.toUtf8();std::fprintf(evidence,"%s\n",bytes.constData());std::fflush(evidence);}
}
static LONG WINAPI trace(EXCEPTION_POINTERS* fault){
    if(!evidence)return EXCEPTION_EXECUTE_HANDLER;
    std::fprintf(evidence,"Exception %08lx at %p\n",fault->ExceptionRecord->ExceptionCode,fault->ExceptionRecord->ExceptionAddress);
    const auto process=GetCurrentProcess();
    if(SymInitialize(process,"",TRUE)){
        CONTEXT context=*fault->ContextRecord;STACKFRAME64 frame{};
        frame.AddrPC={context.Rip,0,AddrModeFlat};frame.AddrStack={context.Rsp,0,AddrModeFlat};frame.AddrFrame={context.Rbp,0,AddrModeFlat};
        for(int i=0;i<40&&frame.AddrPC.Offset;++i){
            HMODULE module=nullptr;wchar_t path[32768]{};
            GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                reinterpret_cast<const wchar_t*>(frame.AddrPC.Offset),&module);
            if(module)GetModuleFileNameW(module,path,DWORD(std::size(path)));
            alignas(SYMBOL_INFO) char storage[sizeof(SYMBOL_INFO)+MAX_SYM_NAME]{};
            auto* symbol=reinterpret_cast<SYMBOL_INFO*>(storage);symbol->SizeOfStruct=sizeof(SYMBOL_INFO);symbol->MaxNameLen=MAX_SYM_NAME;DWORD64 offset=0;
            const bool found=SymFromAddr(process,frame.AddrPC.Offset,&offset,symbol);
            std::fprintf(evidence,"%d %p %s RVA=%llx !%s+%llu\n",i,reinterpret_cast<void*>(frame.AddrPC.Offset),
                QString::fromWCharArray(path).toUtf8().constData(),frame.AddrPC.Offset-reinterpret_cast<DWORD64>(module),found?symbol->Name:"?",offset);
            if(!StackWalk64(IMAGE_FILE_MACHINE_AMD64,process,GetCurrentThread(),&frame,&context,nullptr,SymFunctionTableAccess64,SymGetModuleBase64,nullptr))break;
        }SymCleanup(process);
    }std::fflush(evidence);return EXCEPTION_EXECUTE_HANDLER;
}

// Manual acceptance host: the real Player, MpvVideoItem/worker, managed config,
// native GPU-Next or Render API, shaders and audio. No Emby/WebEngine overlay.
class BenchmarkVideo : public MpvVideoItem {
public:
    using MpvVideoItem::MpvVideoItem;
    using MpvAbstractItem::mpvController;
};

int main(int argc,char** argv)
{
    bool renderApi=false;
    for(int i=1;i+1<argc;++i)
        if(QString::fromUtf8(argv[i])=="--backend"&&QString::fromUtf8(argv[i+1])=="libmpv")renderApi=true;
    QQuickWindow::setGraphicsApi(renderApi?QSGRendererInterface::OpenGL:QSGRendererInterface::Direct3D11);
    QApplication app(argc,argv);
    QCommandLineParser parser;parser.addHelpOption();
    for(const auto& key:{"runtime","cache","monitor","script","media","output","model","target","seconds","warmup","backend","preset","run-id","sync"})
        parser.addOption(QCommandLineOption(key,key,key));
    parser.addOption(QCommandLineOption("baseline","Original-frame comparison"));
    parser.addOption(QCommandLineOption("controls","Exercise pause and seek during measurement"));parser.process(app);
    const auto value=[&](const char* key,const QString& fallback=QString()){
        return parser.isSet(key)?parser.value(key):fallback;
    };
    const auto output=value("output");
    _wfopen_s(&evidence,(output+".native.log").toStdWString().c_str(),L"wb");
    qInstallMessageHandler(message);SetUnhandledExceptionFilter(trace);
    QJsonObject report{{"schemaVersion",1},{"runId",value("run-id")},{"completed",false},
        {"scope","Player+MpvVideoItem+4K renderer+managed shaders+audio; no WebEngine overlay"},
        {"baseline",parser.isSet("baseline")},{"model",value("model","rife-4.25-lite")},
        {"targetFps",value("target","60").toInt()},{"backend",value("backend","gpu-next")},
        {"preset",value("preset","default")},{"requestedSeconds",value("seconds","600").toInt()}};
    QJsonArray samples;
    const auto save=[&]{report["samples"]=samples;QSaveFile file(output);
        if(!file.open(QIODevice::WriteOnly))return false;
        const auto bytes=QJsonDocument(report).toJson();return file.write(bytes)==bytes.size()&&file.commit();};
    const auto fail=[&](const QString& message){report["error"]=message;report["completed"]=false;save();qCritical().noquote()<<message;return 1;};
    if(report["runId"].toString().isEmpty()||!save())return fail("Cannot create the current run's evidence report");
    QTemporaryDir profile;if(!profile.isValid())return fail("Cannot create isolated profile");
    Paths::setConfigDir(profile.path());Paths::setCacheDir(profile.filePath("cache"));
    ProfileManager::Get().setActiveProfile(ProfileManager::createProfile("RIFE renderer acceptance"));
    auto& settings=SettingsComponent::Get();if(!settings.componentInitialize())return fail("Settings initialization failed");
    if(!InputComponent::Get().componentInitialize())return fail("Input initialization failed");
    settings.setValue(SETTINGS_SECTION_MPV,"configMode","embedded");
    settings.setValue(SETTINGS_SECTION_MPV,"renderBackend",report["backend"].toString());
    settings.setValue(SETTINGS_SECTION_MPV,"shaderPreset",report["preset"].toString());
    settings.setValue(SETTINGS_SECTION_VIDEO,"aiRife",!parser.isSet("baseline"));
    settings.setValue(SETTINGS_SECTION_VIDEO,"hardwareDecoding","safe");
    settings.setValue(SETTINGS_SECTION_VIDEO,"refreshrate.auto_switch",false);
    if(parser.isSet("sync"))settings.setValue(SETTINGS_SECTION_VIDEO,"sync_mode",value("sync"));
    if(!MpvConfigManager::prepare())return fail("Managed mpv configuration preparation failed");
    wchar_t module[32768]{};GetModuleFileNameW(GetModuleHandleW(L"libmpv-2.dll"),module,DWORD(std::size(module)));
    const auto loaded=QFileInfo(QString::fromWCharArray(module)).canonicalFilePath();
    report["loadedMpv"]=loaded;
    if(loaded!=QFileInfo(qEnvironmentVariable("RIFE_BENCH_EXPECTED_MPV")).canonicalFilePath())return fail("Unexpected mpv DLL");
    PlayerComponent player;bool ready=false,probeFinished=false;QString probeError,playbackError;
    QObject::connect(&player,&PlayerComponent::windowsRifeReady,&app,[&](bool ok,const QString& error){ready=ok;probeError=error;probeFinished=true;});
    QObject::connect(&player,&PlayerComponent::error,&app,[&](const QString& error){playbackError=error;});
    if(!player.prepareWindowsRife(value("runtime"),value("cache"),value("monitor"),value("script")))return fail("Runtime configuration refused");
    const auto pump=[] {QCoreApplication::processEvents(QEventLoop::AllEvents,10);QThread::msleep(1);};
    QElapsedTimer clock;clock.start();
    while(!probeFinished&&clock.elapsed()<75000)pump();
    if(!ready)return fail("Private runtime activation failed: "+probeError);
    if(!player.selectWindowsRifeModel(report["model"].toString(),report["targetFps"].toInt()))return fail("Model/target selection refused");
    QScreen* screen=nullptr;
    for(auto* candidate:app.screens()){
        const auto physical=candidate->size()*candidate->devicePixelRatio();
        if(physical.width()>=3840&&physical.height()>=2160&&(!screen||candidate->refreshRate()>screen->refreshRate()))screen=candidate;
    }
    if(!screen)return fail("No screen capable of a physical 3840x2160 output");
    report["screen"]=QJsonObject{{"name",screen->name()},{"refreshHz",screen->refreshRate()},{"devicePixelRatio",screen->devicePixelRatio()}};
    QQuickWindow window;window.setScreen(screen);window.setTitle("Tigerest RIFE 4K acceptance");
    window.setFlags(Qt::Window|Qt::FramelessWindowHint);
    window.setGeometry(QRect(screen->geometry().topLeft(),QSize(qRound(3840/screen->devicePixelRatio()),qRound(2160/screen->devicePixelRatio()))));
    auto* video=new BenchmarkVideo(window.contentItem());video->setObjectName("video");
    video->setWidth(window.width());video->setHeight(window.height());
    bool renderReady=!renderApi;
    QObject::connect(video,&MpvAbstractItem::ready,&app,[&]{renderReady=true;});
    player.setWindow(&window);window.show();
    QObject::connect(&window,&QWindow::visibleChanged,&app,[&](bool visible){if(!visible)playbackError="Benchmark window was closed or hidden";});
    auto* controller=video->mpvController();
    clock.restart();
    while(!renderReady&&clock.elapsed()<15000&&playbackError.isEmpty())pump();
    if(!renderReady)return fail("Render API context was not ready before media load");
    controller->setProperty("mute",true);controller->setProperty("msg-level","all=warn");
    if(!player.load(QUrl::fromLocalFile(value("media")).toString(),{{"autoplay",true}},{},1))return fail("Real Player rejected media");
    const auto read=[&](const QString& key){const auto v=controller->getProperty(key);
        return v.metaType().id()==qMetaTypeId<ErrorReturn>()?QVariant():v;};
    const auto snapshot=[&]{return QJsonObject{{"rife",QJsonObject::fromVariantMap(player.windowsRifeStatus())},
        {"playbackSeconds",QJsonValue::fromVariant(read("playback-time"))},
        {"voDrops",QJsonValue::fromVariant(read("frame-drop-count"))},
        {"decoderDrops",QJsonValue::fromVariant(read("decoder-frame-drop-count"))},
        {"avsyncSeconds",QJsonValue::fromVariant(read("avsync"))},
        {"paused",QJsonValue::fromVariant(read("pause"))},
        {"pausedForCache",QJsonValue::fromVariant(read("paused-for-cache"))},
        {"cacheBuffering",QJsonValue::fromVariant(read("cache-buffering-state"))},
        {"coreIdle",QJsonValue::fromVariant(read("core-idle"))},
        {"audioOutput",QJsonValue::fromVariant(read("current-ao"))},
        {"videoSync",QJsonValue::fromVariant(read("video-sync"))},
        {"audioParams",QJsonValue::fromVariant(read("audio-params"))},
        {"osdDimensions",QJsonValue::fromVariant(read("osd-dimensions"))},
        {"videoOutParams",QJsonValue::fromVariant(read("video-out-params"))},
        {"vfFps",QJsonValue::fromVariant(read("estimated-vf-fps"))}};};
    clock.restart();
    const int warmup=value("warmup","15").toInt();
    while(clock.elapsed()<warmup*1000&&playbackError.isEmpty())pump();
    report["configuration"]=QJsonObject::fromVariantMap(player.mpvDiagnostics());
    report["warmupSeconds"]=warmup;
    report["warmupSnapshot"]=snapshot();
    // Avoid manufacturing dropped frames that could trip the real guard just
    // to capture evidence. Resume and settle before the measured interval.
    player.pause();const auto pauseUntil=clock.elapsed()+2000;
    while(!read("pause").toBool()&&clock.elapsed()<pauseUntil&&playbackError.isEmpty())pump();
    if(!read("pause").toBool())return fail("Cannot pause for screenshot capture");
    // QScreen::grabWindow captures the Qt parent but can omit a D3D child.
    // Ask mpv for its actual rendered window, including scaling and shaders.
    const auto framePath=QFileInfo(output).absolutePath()+"/"+QFileInfo(output).completeBaseName()+"-frame.png";
    const auto screenshot=controller->command(QStringList{"screenshot-to-file",framePath,"window"});
    report["renderScreenshotSucceeded"]=screenshot.metaType().id()!=qMetaTypeId<ErrorReturn>();
    player.play();
    // Readback/PNG encoding can briefly stall the renderer. Exclude it and
    // allow the audio clock to settle before taking any measurement baseline.
    const auto settleUntil=clock.elapsed()+5000;
    while(clock.elapsed()<settleUntil&&playbackError.isEmpty())pump();
    report["excludedStartupSeconds"]=clock.elapsed()/1000.;
    report["initial"]=snapshot();if(!save())return fail("Cannot save the measurement baseline");
    if(!playbackError.isEmpty())return fail(playbackError);
    const auto initial=report["initial"].toObject();const auto firstRife=initial["rife"].toObject()["playback"].toObject();
    if(!parser.isSet("baseline")&&firstRife["state"].toInt()!=2){
        report["performanceFallback"]=firstRife["reason"].toString()=="performance";
        report["final"]=initial;report["measuredSeconds"]=0.;
        return fail("RIFE was not active after warmup: "+firstRife["reason"].toString());
    }
    clock.restart();qint64 next=1000;bool fallback=false,controlsDone=false;
    while(clock.elapsed()<report["requestedSeconds"].toInt()*1000&&playbackError.isEmpty()){
        pump();if(clock.elapsed()<next)continue;next+=1000;
        if(parser.isSet("controls")&&!controlsDone&&clock.elapsed()>report["requestedSeconds"].toInt()*500){
            controlsDone=true;player.pause();
            auto deadline=clock.elapsed()+2000;
            while(!read("pause").toBool()&&clock.elapsed()<deadline)pump();
            if(!read("pause").toBool()){playbackError="Pause did not take effect";break;}
            const auto pausedPosition=read("playback-time").toDouble();
            deadline=clock.elapsed()+500;while(clock.elapsed()<deadline)pump();
            if(std::abs(read("playback-time").toDouble()-pausedPosition)>.1){playbackError="Paused position advanced";break;}
            const auto epoch=player.windowsRifeStatus()["playback"].toMap()["epoch"].toULongLong();
            const auto targetPosition=pausedPosition+10.;player.seekTo(qint64(targetPosition*1000));player.play();
            deadline=clock.elapsed()+12000;bool recovered=false;
            while(clock.elapsed()<deadline&&playbackError.isEmpty()){
                pump();const auto state=player.windowsRifeStatus()["playback"].toMap();
                if(state["state"].toInt()==2&&state["epoch"].toULongLong()!=epoch&&
                   read("playback-time").toDouble()>=targetPosition-.1){recovered=true;break;}
            }
            report["controlsPassed"]=recovered;
            if(!recovered){playbackError="Interpolation did not recover after pause/seek";break;}
        }
        auto sample=snapshot();sample["elapsedSeconds"]=clock.elapsed()/1000.;samples.append(sample);
        if(!save()){playbackError="Cannot save measurement samples";break;}
        if(!read("playback-time").isValid()){playbackError="Media ended before the measurement completed";break;}
        const auto rife=sample["rife"].toObject()["playback"].toObject();
        if(!parser.isSet("baseline")&&rife["state"].toInt()!=2){
            fallback=rife["reason"].toString()=="performance";
            if(!fallback)playbackError="RIFE stopped during measurement: "+rife["reason"].toString();
            break;
        }
    }
    const auto final=snapshot();const auto measuredSeconds=clock.elapsed()/1000.;
    if(fallback){
        const auto recoverUntil=clock.elapsed()+1500;
        while(clock.elapsed()<recoverUntil&&playbackError.isEmpty())pump();
        report["fallbackRecovery"]=snapshot();
    }
    report["final"]=final;report["measuredSeconds"]=measuredSeconds;
    report["performanceFallback"]=fallback;report["completed"]=playbackError.isEmpty()&&!fallback;
    report["error"]=playbackError;const bool saved=save();player.stop();
    for(int i=0;i<100;++i)pump();
    // QQuickWindow owns the video item; its real destructor stops the worker
    // and destroys libmpv before Player's destructor closes statistics.
    return saved&&playbackError.isEmpty()?0:1;
}

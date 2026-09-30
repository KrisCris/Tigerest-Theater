#ifdef NDEBUG
#undef NDEBUG
#endif
#include "windows/RifeVSScriptRuntime.h"
#include <mpv/client.h>
#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <cassert>
#include <cstdio>
#include <windows.h>

// This intentionally works with the original DLL as well as the EOF-aware
// build. It only proves the pre-mpv_create environment contract, not RIFE/EOF.
int main(int argc,char** argv){
    QCoreApplication app(argc,argv);
    const auto root=QFileInfo(qEnvironmentVariable("RIFE_TEST_RUNTIME")).canonicalFilePath();
    const auto dll=QFileInfo(qEnvironmentVariable("RIFE_TEST_MPV_DLL")).canonicalFilePath();
    assert(!root.isEmpty()&&!dll.isEmpty());
    const bool late=app.arguments().contains("--late");
    QTemporaryDir temp;assert(temp.isValid());
    const auto source=temp.path()+"/input.y4m",script=temp.path()+"/private.vpy",marker=temp.path()+"/evaluated";
    {
        QFile file(source);assert(file.open(QIODevice::WriteOnly));
        file.write("YUV4MPEG2 W16 H16 F24:1 Ip A1:1 C420\n");
        for(int n=0;n<8;++n){file.write("FRAME\n");file.write(QByteArray(256,char(64+n)));file.write(QByteArray(128,char(128)));}
    }
    {
        QFile file(script);assert(file.open(QIODevice::WriteOnly));
        const auto strings=QJsonDocument(QJsonArray{root,marker}).toJson(QJsonDocument::Compact);
        file.write("import sys\nfrom pathlib import Path\n");
        file.write("root,marker=");file.write(strings);file.write("\n");
        file.write("assert sys.flags.isolated and sys.flags.ignore_environment and sys.flags.no_site\n"
            "assert sys.dont_write_bytecode and 'site' not in sys.modules\n"
            "assert all(Path(p).resolve().is_relative_to(Path(root).resolve()) for p in sys.path)\n"
            "Path(marker).write_text('private mpv script',encoding='utf-8')\n"
            "video_in.set_output()\n");
    }
    // Poison the path before the first actual mpv environment read. In late
    // mode activation updates the OS, but cannot update mpv's snapshot.
    assert(_wputenv_s(L"VSSCRIPT_PATH",(root+"/missing-vsscript.dll").toStdWString().c_str())==0);
    qputenv("PYTHONHOME","C:/untrusted-python-fixture");
    qputenv("PYTHONPATH","C:/untrusted-python-fixture/modules");
    const auto library=LoadLibraryExW(dll.toStdWString().c_str(),nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);assert(library);
    const auto create=reinterpret_cast<decltype(&mpv_create)>(GetProcAddress(library,"mpv_create"));
    const auto initialize=reinterpret_cast<decltype(&mpv_initialize)>(GetProcAddress(library,"mpv_initialize"));
    const auto option=reinterpret_cast<decltype(&mpv_set_option_string)>(GetProcAddress(library,"mpv_set_option_string"));
    const auto command=reinterpret_cast<decltype(&mpv_command)>(GetProcAddress(library,"mpv_command"));
    const auto logs=reinterpret_cast<decltype(&mpv_request_log_messages)>(GetProcAddress(library,"mpv_request_log_messages"));
    const auto wait=reinterpret_cast<decltype(&mpv_wait_event)>(GetProcAddress(library,"mpv_wait_event"));
    const auto destroy=reinterpret_cast<decltype(&mpv_terminate_destroy)>(GetProcAddress(library,"mpv_terminate_destroy"));
    assert(create&&initialize&&option&&command&&logs&&wait&&destroy);
    QString error;
    if(!late)assert(rife::activateVSScriptRuntime(root,&error));
    auto* handle=create();assert(handle);
    if(late)assert(rife::activateVSScriptRuntime(root,&error));
    assert(option(handle,"config","no")==0);
    assert(option(handle,"vo","null")==0);
    assert(option(handle,"ao","null")==0);
    assert(option(handle,"audio","no")==0);
    assert(option(handle,"terminal","no")==0);
    assert(option(handle,"idle","yes")==0);
    assert(logs(handle,"v")==0);
    assert(initialize(handle)==0);
    const auto path=script.toUtf8();
    const auto filter="vapoursynth=file=%"+QByteArray::number(path.size())+"%"+path+":buffered-frames=4:concurrent-frames=2";
    const char* add[]={"vf","add",filter.constData(),nullptr};assert(command(handle,add)>=0);
    const auto input=source.toUtf8();const char* load[]={"loadfile",input.constData(),nullptr};assert(command(handle,load)>=0);
    bool failedToLoad=false;QByteArray messages;QElapsedTimer clock;clock.start();
    while(clock.elapsed()<10000&&!QFileInfo(marker).isFile()&&!failedToLoad){
        const auto* event=wait(handle,.05);
        if(event->event_id==MPV_EVENT_LOG_MESSAGE){
            const auto* message=static_cast<mpv_event_log_message*>(event->data);
            messages+=message->text;
            if(QByteArray(message->text).contains("Failed to load VapourSynth VSScript library:"))failedToLoad=true;
        }
    }
    const bool evaluated=QFileInfo(marker).isFile();
    destroy(handle);FreeLibrary(library);
    if(evaluated!=!late||(late&&!failedToLoad)){
        std::fprintf(stderr,"mpv private startup (%s) failed:\n%s",late?"late":"early",messages.constData());return 1;
    }
    assert(evaluated==!late);
    std::puts(late?"Late activation cannot replace mpv's cached environment":"mpv evaluates private isolated Python after early activation");
}

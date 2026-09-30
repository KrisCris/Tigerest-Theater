#include "RifeVsMonitor.h"
VS_EXTERNAL_API(void) VapourSynthPluginInit2(VSPlugin* plugin,const VSPLUGINAPI* api) {
    api->configPlugin("io.github.tigerest.rife","tigerest","Tigerest RIFE monitor",VS_MAKE_VERSION(1,0),VAPOURSYNTH_API_VERSION,0,plugin);
    rife::registerMonitor(plugin,api);
}

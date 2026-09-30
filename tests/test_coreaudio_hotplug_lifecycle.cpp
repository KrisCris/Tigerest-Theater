#ifdef NDEBUG
#undef NDEBUG
#endif
#include <mpv/client.h>
#include <cassert>
#include <chrono>

// Enumerating devices creates a temporary CoreAudio hotplug AO. Repeatedly
// tear down that AO while HAL notifications may still be queued.
int main() {
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(60);
    for(int i=0;i<30;i++) {
        assert(std::chrono::steady_clock::now()<deadline);
        mpv_handle* player=mpv_create();
        assert(player);
        assert(mpv_set_option_string(player,"terminal","no")>=0);
        assert(mpv_set_option_string(player,"vo","null")>=0);
        assert(mpv_set_option_string(player,"ao","coreaudio")>=0);
        assert(mpv_initialize(player)>=0);
        mpv_node devices{};
        assert(mpv_get_property(player,"audio-device-list",MPV_FORMAT_NODE,&devices)>=0);
        mpv_free_node_contents(&devices);
        mpv_terminate_destroy(player);
    }
}

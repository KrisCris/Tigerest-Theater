// Real pinned mpv filter graph/queues, deliberately slow fake inference core.
// No Core ML, production media, credentials or player profile is used.
#include <assert.h>
#include <math.h>
#include <stdatomic.h>
#include <stdio.h>
#include <time.h>
#include <unistd.h>
#ifdef TIGEREST_RIFE_TIMING
#include <pthread/qos.h>
#endif
#include "common/global.h"
#include "common/msg.h"
#include "common/tags.h"
#include "filters/filter_internal.h"
#include "filters/user_filters.h"
#include "osdep/timer.h"
#include "video/mp_image.h"

static atomic_int started, finished, resets, destroyed;
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
static void slow_process(struct mp_filter *f) {
    if (!mp_pin_in_needs_data(f->ppins[1])) return;
    struct mp_frame frame = mp_pin_out_read(f->ppins[0]);
    if (frame.type == MP_FRAME_NONE) return;
    if (frame.type == MP_FRAME_VIDEO) {
        atomic_fetch_add(&started, 1);
        usleep(50000);
        atomic_fetch_add(&finished, 1);
    }
    mp_pin_in_write(f->ppins[1], frame);
}
static void slow_reset(struct mp_filter *f) { (void)f; atomic_fetch_add(&resets, 1); }
static void slow_destroy(struct mp_filter *f) { (void)f; atomic_fetch_add(&destroyed, 1); }
static bool slow_command(struct mp_filter *f, struct mp_filter_command *cmd) {
    (void)f;
    if (cmd->type != MP_FILTER_COMMAND_GET_META) return false;
    struct mp_tags *tags = talloc_zero(NULL, struct mp_tags);
    char value[32]; snprintf(value, sizeof(value), "%d", atomic_load(&finished));
    mp_tags_set_str(tags, "finished", value);
    *(struct mp_tags **)cmd->res = tags; return true;
}
static const struct mp_filter_info slow_info = {
    .name = "slow-test-core", .process = slow_process, .reset = slow_reset,
    .destroy = slow_destroy, .command = slow_command,
};
static struct mp_filter *slow_create(struct mp_filter *parent, void *options) {
    talloc_free(options);
    struct mp_filter *f = mp_filter_create(parent, &slow_info);
    mp_filter_add_pin(f, MP_PIN_IN, "in"); mp_filter_add_pin(f, MP_PIN_OUT, "out"); return f;
}
#ifdef TEST_DIRECT_CORE
const struct mp_user_filter_entry vf_tigerest_rife = {.create = slow_create};
#else
const struct mp_user_filter_entry vf_tigerest_rife_core = {.create = slow_create};
extern const struct mp_user_filter_entry vf_tigerest_rife;
#endif

struct session { struct mpv_global global; struct mp_filter *root, *filter; int sent, received, total; bool eof_sent, eof, large; double max_call, base; };
static void begin(struct session *s, int total, double base) {
    *s = (struct session){.total = total, .base = base};
    s->global.log = mp_null_log;
    s->root = mp_filter_create_root(&s->global);
    s->filter = vf_tigerest_rife.create(s->root, NULL); assert(s->filter);
}
static void step(struct session *s, bool read_output) {
    double start = now();
    if (mp_pin_in_needs_data(s->filter->pins[0]) && !s->eof_sent) {
        struct mp_frame frame = {MP_FRAME_EOF};
        if (s->sent < s->total) {
            struct mp_image *image = mp_image_alloc(IMGFMT_RGBA, s->large ? 4096 : 4, s->large ? 3000 : 4); assert(image);
            image->pts = s->base + s->sent / 24.0; image->nominal_fps = 24; s->sent++;
            frame = MAKE_FRAME(MP_FRAME_VIDEO, image);
        } else s->eof_sent = true;
        mp_pin_in_write(s->filter->pins[0], frame);
    }
    if (read_output) {
        struct mp_frame out = mp_pin_out_read(s->filter->pins[1]);
        if (out.type == MP_FRAME_VIDEO) {
            struct mp_image *image = out.data;
            assert(fabs(image->pts - (s->base + s->received / 24.0)) < 1e-8);
            s->received++;
        } else if (out.type == MP_FRAME_EOF) s->eof = true;
        else assert(out.type == MP_FRAME_NONE);
        mp_frame_unref(&out);
    }
    mp_filter_graph_run(s->root);
    struct mp_tags *tags = NULL;
    struct mp_filter_command cmd = {.type = MP_FILTER_COMMAND_GET_META, .res = &tags};
    assert(mp_filter_command(s->filter, &cmd)); talloc_free(tags);
    s->max_call = fmax(s->max_call, now() - start);
}
static void drain(struct session *s) {
    double deadline = now() + 5;
    while (!s->eof && now() < deadline) { step(s, true); usleep(1000); }
    assert(s->eof && s->received == s->total);
}
#ifdef TIGEREST_RIFE_TIMING
static void probe_qos(struct session *s, const char *mode, int expected) {
    struct mp_filter_command cmd = {.type = MP_FILTER_COMMAND_TEXT, .cmd = "probe-qos", .arg = mode};
    assert(mp_filter_command(s->filter, &cmd));
    double deadline = now() + 1;
    int actual = -1;
    while (now() < deadline) {
        struct mp_tags *tags = NULL;
        struct mp_filter_command meta = {.type = MP_FILTER_COMMAND_GET_META, .res = &tags};
        assert(mp_filter_command(s->filter, &meta));
        const char *qos = mp_tags_get_str(tags, "workerQoS");
        if (qos) actual = atoi(qos);
        talloc_free(tags);
        if (actual == expected) break;
        usleep(1000);
    }
    assert(actual == expected);
    cmd.arg = "arbitrary"; assert(!mp_filter_command(s->filter, &cmd));
}
#endif
int main(void) {
    mp_time_init();
    struct session s;
    begin(&s, 12, 0);
#ifdef TIGEREST_RIFE_TIMING
    probe_qos(&s, "user-initiated", QOS_CLASS_USER_INITIATED);
#endif
    drain(&s);
#ifdef TIGEREST_RIFE_TIMING
    probe_qos(&s, "default", QOS_CLASS_DEFAULT);
    puts("PASS diagnostic QoS changes run on worker and reject invalid modes");
#endif
    printf("50 ms core: maximum player-thread call %.3f ms\n", s.max_call * 1000);
    if (s.max_call > .02) { fprintf(stderr, "FAIL: inference blocks player thread\n"); talloc_free(s.root); return 1; }
    talloc_free(s.root); puts("PASS nonblocking delivery, metadata and ordered EOF");
    for (int n = 0; n <= 3; n++) { begin(&s, n, 5); drain(&s); talloc_free(s.root); }
    puts("PASS short/empty streams drain before prefill threshold");
    begin(&s, 12, 5); s.large = true; drain(&s); talloc_free(s.root);
    puts("PASS byte-limited prefill drains large unsupported frames");
    begin(&s, 100, 0);
    double deadline = now() + .8;
    while (now() < deadline) { step(&s, false); usleep(1000); }
    assert(s.sent > 0 && s.sent <= 12);
    mp_filter_reset(s.root);
    s.sent = s.received = 0; s.eof_sent = s.eof = false; s.total = 5; s.base = 100;
    drain(&s); talloc_free(s.root);
    puts("PASS bounded backpressure and seek discards old frames");
    for (int n = 0; n < 10; n++) {
        begin(&s, 100, 0); deadline = now() + .012;
        while (now() < deadline) { step(&s, true); usleep(1000); }
        talloc_free(s.root);
    }
    assert(atomic_load(&started) == atomic_load(&finished));
    assert(atomic_load(&destroyed) == 17);
    puts("PASS repeated destruction while inference is in flight");
    return 0;
}

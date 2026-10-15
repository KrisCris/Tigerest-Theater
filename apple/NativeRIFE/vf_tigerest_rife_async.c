// Keep Core ML and RGB conversion off mpv's playback/control thread. The
// private filter retains its pixel/timestamp contract; only graph ownership
// changes. Queue/reset ownership follows mpv's threaded decoder wrapper.
#include <math.h>
#include <stdatomic.h>
#include "common/tags.h"
#include "filters/filter_internal.h"
#include "filters/f_async_queue.h"
#include "filters/user_filters.h"
#include "misc/dispatch.h"
#include "osdep/threads.h"
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
#include <pthread/qos.h>
#endif

extern const struct mp_user_filter_entry vf_tigerest_rife_core;
struct async_priv {
    struct mp_filter *root, *core, *input_writer, *output_reader;
    struct mp_async_queue *input, *output;
    struct mp_dispatch_queue *dispatch;
    mp_thread thread;
    bool thread_valid, primed, input_eof;
    atomic_bool terminate;
    mp_mutex metadata_lock;
    struct mp_tags *metadata;
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
    atomic_int probe_qos;
#endif
};

static void wakeup_worker(void *ptr) {
    struct async_priv *p = ptr;
    mp_dispatch_interrupt(p->dispatch);
}
static void interrupt_worker(void *ptr) {
    struct async_priv *p = ptr;
    mp_filter_graph_interrupt(p->root);
}
static MP_THREAD_VOID worker(void *ptr) {
    struct async_priv *p = ptr;
    mp_thread_set_name("rife/video");
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
    int applied_qos = -1, qos_error = 0;
#endif
    while (!atomic_load(&p->terminate)) {
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
        int requested_qos = atomic_load(&p->probe_qos);
        if (requested_qos != applied_qos) {
            qos_error = pthread_set_qos_class_self_np(requested_qos == 1 ? QOS_CLASS_USER_INITIATED : QOS_CLASS_DEFAULT, 0);
            applied_qos = requested_qos;
        }
#endif
        mp_filter_graph_run(p->root);
        struct mp_tags *next = NULL;
        struct mp_filter_command cmd = {.type = MP_FILTER_COMMAND_GET_META, .res = &next};
        mp_filter_command(p->core, &cmd);
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
        if (!next) next = talloc_zero(NULL, struct mp_tags);
        qos_class_t actual_qos = QOS_CLASS_UNSPECIFIED;
        pthread_get_qos_class_np(pthread_self(), &actual_qos, NULL);
        mp_tags_set_str(next, "workerQoS", mp_tprintf(32, "%u", actual_qos));
        mp_tags_set_str(next, "workerQoSError", mp_tprintf(32, "%d", qos_error));
#endif
        mp_mutex_lock(&p->metadata_lock);
        talloc_free(p->metadata); p->metadata = next;
        mp_mutex_unlock(&p->metadata_lock);
        mp_dispatch_queue_process(p->dispatch, INFINITY);
    }
    MP_THREAD_RETURN();
}
static void process(struct mp_filter *f) {
    struct async_priv *p = f->priv;
    if (mp_pin_in_needs_data(p->input_writer->pins[0])) {
        struct mp_frame frame = mp_pin_out_read(f->ppins[0]);
        if (frame.type != MP_FRAME_NONE) {
            if (frame.type == MP_FRAME_EOF) p->input_eof = true;
            mp_pin_in_write(p->input_writer->pins[0], frame);
        }
    }
    // Start with a small reserve, so the first expensive pair does not miss
    // its half-frame deadline. Short streams must still drain through EOF.
    if (!p->primed && (mp_async_queue_is_full(p->output) || p->input_eof))
        p->primed = true;
    if (p->primed && mp_pin_in_needs_data(f->ppins[1])) {
        struct mp_frame frame = mp_pin_out_read(p->output_reader->pins[0]);
        if (frame.type != MP_FRAME_NONE) mp_pin_in_write(f->ppins[1], frame);
    }
}
static void reset(struct mp_filter *f) {
    struct async_priv *p = f->priv;
    mp_async_queue_reset(p->input); mp_async_queue_reset(p->output);
    if (p->thread_valid) mp_dispatch_lock(p->dispatch);
    mp_filter_reset(p->root);
    p->primed = p->input_eof = false;
    mp_mutex_lock(&p->metadata_lock);
    talloc_free(p->metadata); p->metadata = NULL;
    mp_mutex_unlock(&p->metadata_lock);
    mp_dispatch_interrupt(p->dispatch);
    if (p->thread_valid) mp_dispatch_unlock(p->dispatch);
    mp_async_queue_resume_reading(p->input);
    mp_async_queue_resume_reading(p->output);
}
static bool command(struct mp_filter *f, struct mp_filter_command *cmd) {
    struct async_priv *p = f->priv;
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
    // Diagnostic builds only: compare QoS without restarting playback or
    // changing user preferences. The worker must set its own scheduling class.
    if (cmd->type == MP_FILTER_COMMAND_TEXT && cmd->cmd && cmd->arg && !strcmp(cmd->cmd, "probe-qos")) {
        int mode = !strcmp(cmd->arg, "default") ? 0 : !strcmp(cmd->arg, "user-initiated") ? 1 : -1;
        if (mode < 0) return false;
        atomic_store(&p->probe_qos, mode);
        mp_dispatch_interrupt(p->dispatch);
        return true;
    }
#endif
    if (cmd->type != MP_FILTER_COMMAND_GET_META) return false;
    mp_mutex_lock(&p->metadata_lock);
    struct mp_tags *copy = p->metadata ? mp_tags_dup(NULL, p->metadata) : talloc_zero(NULL, struct mp_tags);
    mp_mutex_unlock(&p->metadata_lock);
    mp_tags_set_str(copy, "async", "yes");
#ifdef TIGEREST_RIFE_TIMING
    mp_tags_set_str(copy, "inputQueueFrames", mp_tprintf(32, "%d", mp_async_queue_get_frames(p->input)));
    mp_tags_set_str(copy, "outputQueueFrames", mp_tprintf(32, "%d", mp_async_queue_get_frames(p->output)));
#endif
    *(struct mp_tags **)cmd->res = copy; return true;
}
static void destroy(struct mp_filter *f) {
    struct async_priv *p = f->priv;
    if (p->thread_valid) {
        mp_dispatch_lock(p->dispatch);
        atomic_store(&p->terminate, true);
        mp_dispatch_interrupt(p->dispatch);
        mp_dispatch_unlock(p->dispatch);
        mp_thread_join(p->thread);
    }
    // Detach both sides before freeing queues; no wakeup can outlive f.
    mp_filter_free_children(f);
    talloc_free(p->root);
    talloc_free(p->input); talloc_free(p->output);
    talloc_free(p->metadata);
    mp_mutex_destroy(&p->metadata_lock);
}
static const struct mp_filter_info info = {
    .name = "tigerest-rife", .priv_size = sizeof(struct async_priv),
    .process = process, .reset = reset, .destroy = destroy, .command = command,
};
static struct mp_filter *create(struct mp_filter *parent, void *options) {
    talloc_free(options);
    struct mp_filter *f = mp_filter_create(parent, &info);
    if (!f) return NULL;
    struct async_priv *p = f->priv;
    mp_mutex_init(&p->metadata_lock);
#if defined(TIGEREST_RIFE_TIMING) && defined(__APPLE__)
    atomic_init(&p->probe_qos, -1);
#endif
    mp_filter_add_pin(f, MP_PIN_IN, "in"); mp_filter_add_pin(f, MP_PIN_OUT, "out");
    p->input = mp_async_queue_create(); p->output = mp_async_queue_create();
    // Float RGB output is ~25 MB per 1080p frame. Bounded queues prevent
    // prefetch from becoming an unbounded memory/latency cost on long videos.
    mp_async_queue_set_config(p->input, (struct mp_async_queue_config){.max_samples = 2, .max_bytes = 64 * 1024 * 1024});
    mp_async_queue_set_config(p->output, (struct mp_async_queue_config){.max_samples = 4, .max_bytes = 128 * 1024 * 1024});
    p->dispatch = mp_dispatch_create(p);
    p->root = mp_filter_create_root(f->global);
    mp_filter_graph_set_wakeup_cb(p->root, wakeup_worker, p);
    mp_filter_graph_set_max_run_time(p->root, .05);
    mp_dispatch_set_onlock_fn(p->dispatch, interrupt_worker, p);
    p->core = vf_tigerest_rife_core.create(p->root, NULL);
    if (!p->core) { talloc_free(f); return NULL; }
    p->input_writer = mp_async_queue_create_filter(f, MP_PIN_IN, p->input);
    struct mp_filter *input_reader = mp_async_queue_create_filter(p->root, MP_PIN_OUT, p->input);
    mp_pin_connect(p->core->pins[0], input_reader->pins[0]);
    struct mp_filter *output_writer = mp_async_queue_create_filter(p->root, MP_PIN_IN, p->output);
    p->output_reader = mp_async_queue_create_filter(f, MP_PIN_OUT, p->output);
    mp_pin_connect(output_writer->pins[0], p->core->pins[1]);
    mp_async_queue_set_notifier(output_writer, f);
    if (mp_thread_create(&p->thread, worker, p)) { talloc_free(f); return NULL; }
    p->thread_valid = true;
    reset(f);
    return f;
}
const struct mp_user_filter_entry vf_tigerest_rife = {
    .desc = {.name = "tigerest-rife", .description = "iPad Core ML RIFE 4.25 lite, 1080p SDR 2x"},
    .create = create,
};

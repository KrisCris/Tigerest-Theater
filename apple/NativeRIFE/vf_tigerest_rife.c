// iPad adapter for mpv v0.41.0. Ownership and scheduling follow mpv filters.
// The output stays in mpv's timestamped video queue, ahead of subtitles/shaders.
#include "NativeRIFE.h"
#include "common/tags.h"
#include "filters/filter_internal.h"
#include "filters/user_filters.h"
#include "options/m_config_core.h"
#include "options/options.h"
#include "video/fmt-conversion.h"
#include "video/mp_image.h"
#include "video/mp_image_pool.h"
#include "video/sws_utils.h"
#include <libavutil/pixfmt.h>
#include <math.h>
struct priv {
    void *engine;
    struct mp_image_pool *pool, *download_pool;
    struct mp_sws_context *sws;
    struct m_config_cache *opts;
    struct mp_image *previous, *pending;
    uint64_t generation;
    int64_t index, inputs, outputs, generated, bypassed, resets, failures;
    int recovery_frames;
    double last_ms;
    const char *status;
    bool failed, speed_bypass;
};
static double playback_speed(struct priv *p) {
    // SET_SPEED commands are sent to audio filters, not the video chain.
    m_config_cache_update(p->opts);
    return ((struct MPOpts *)p->opts->opts)->playback_speed;
}
static void reset(struct mp_filter *f) {
    struct priv *p = f->priv;
    mp_image_unrefp(&p->previous);
    mp_image_unrefp(&p->pending);
    p->generation++;
    p->index = 0;
    p->recovery_frames = 0;
    p->resets++;
    tgrife_reset(p->engine);
}
static void destroy(struct mp_filter *f) {
    reset(f);
    tgrife_destroy(((struct priv *)f->priv)->engine);
}
static bool eligible(struct mp_image *img) {
    return img->w == 1920 && img->h == 1080 && img->nominal_fps >= 23 &&
           img->nominal_fps <= 30.01 && isfinite(img->pts) && img->pts != MP_NOPTS_VALUE &&
           !(img->fields & MP_IMGFIELD_INTERLACED) &&
           img->params.color.primaries == PL_COLOR_PRIM_BT_709 &&
           (img->params.color.transfer == PL_COLOR_TRC_BT_1886 ||
            img->params.color.transfer == PL_COLOR_TRC_SRGB) &&
           img->params.repr.sys != PL_COLOR_SYSTEM_DOLBYVISION;
}
static struct mp_image *convert(struct mp_filter *f, struct mp_image *src) {
    struct priv *p = f->priv;
    // fmt describes the underlying NV12/P010 layout even for a hardware image.
    // Detect the surface using imgfmt, otherwise swscale receives VideoToolbox.
    struct mp_image *sw = IMGFMT_IS_HWACCEL(src->imgfmt)
                              ? mp_image_hw_download(src, p->download_pool)
                              : mp_image_new_ref(src);
    if (!sw) {
        p->status = "download-failed";
        return NULL;
    }
    struct mp_image *rgb =
        mp_image_pool_get(p->pool, pixfmt2imgfmt(AV_PIX_FMT_GBRPF32), src->w, src->h);
    if (rgb) {
        mp_image_copy_attributes(rgb, sw);
        rgb->params.repr.sys = PL_COLOR_SYSTEM_RGB;
        rgb->params.repr.levels = PL_COLOR_LEVELS_FULL;
        rgb->params.repr.bits = (struct pl_bit_encoding){0};
        if (mp_sws_scale(p->sws, rgb, sw) < 0) {
            p->status = "swscale-failed";
            mp_image_unrefp(&rgb);
        }
    } else
        p->status = "allocation-failed";
    talloc_free(sw);
    return rgb;
}
static void send(struct mp_filter *f, struct mp_image *img) {
    struct priv *p = f->priv;
    p->outputs++;
    mp_pin_in_write(f->ppins[1], MAKE_FRAME(MP_FRAME_VIDEO, img));
}
static void process(struct mp_filter *f) {
    struct priv *p = f->priv;
    if (!mp_pin_in_needs_data(f->ppins[1]))
        return;
    if (p->pending) {
        struct mp_image *img = p->pending;
        p->pending = NULL;
        send(f, img);
        return;
    }
    struct mp_frame frame = mp_pin_out_read(f->ppins[0]);
    if (frame.type == MP_FRAME_NONE)
        return;
    if (frame.type != MP_FRAME_VIDEO) {
        reset(f);
        mp_pin_in_write(f->ppins[1], frame);
        return;
    }
    struct mp_image *input = frame.data;
    p->inputs++;
    const bool speed_bypass = playback_speed(p) > 1.0001;
    const bool supported = eligible(input);
    if (speed_bypass != p->speed_bypass) {
        // Pending originals have already drained above. Clear only frame/cache
        // history on a mode transition, retaining the model and failure latch.
        reset(f);
        p->speed_bypass = speed_bypass;
        // Give buffered fast audio time to settle before restoring expensive
        // interpolation. Count source frames, never block the filter thread.
        if (!speed_bypass && supported && !p->failed)
            p->recovery_frames = (int)ceil(input->nominal_fps * 0.35);
    }
    if (p->failed || speed_bypass || !supported) {
        p->recovery_frames = 0;
        if (p->previous)
            reset(f);
        if (!p->failed)
            p->status = speed_bypass ? "speed-bypass" : "unsupported-source";
        p->bypassed++;
        send(f, input);
        return;
    }
    if (p->recovery_frames > 0) {
        p->recovery_frames--;
        p->status = "speed-recovery";
        p->bypassed++;
        send(f, input);
        return;
    }
    struct mp_image *img = convert(f, input);
    if (!img) {
        p->failures++;
        p->bypassed++;
        p->failed = true;
        reset(f);
        send(f, input);
        return;
    }
    talloc_free(input);
    const double interval = p->previous ? img->pts - p->previous->pts : 0;
    const bool continuous = p->previous &&
                            mp_image_params_static_equal(&p->previous->params, &img->params) &&
                            fabs(interval - 1.0 / img->nominal_fps) < 0.0015;
    if (p->previous && !continuous)
        reset(f);
    if (!p->engine)
        p->engine = tgrife_create();
    if (!p->engine) {
        p->failures++;
        p->failed = true;
        p->status = "model-unavailable";
        send(f, img);
        return;
    }
    p->index++;
    struct mp_image *mid = NULL;
    if (continuous) {
        mid = mp_image_pool_get(p->pool, img->imgfmt, img->w, img->h);
        if (mid) {
            mp_image_copy_attributes(mid, img);
            if (!tgrife_interpolate(p->engine, (const float **)p->previous->planes,
                                    p->previous->stride, (const float **)img->planes, img->stride,
                                    (float **)mid->planes, mid->stride, p->generation, p->index,
                                    &p->last_ms)) {
                mp_image_unrefp(&mid);
                p->failures++;
                p->failed = true;
                p->status = "inference-failed";
            } else {
                mid->pts = p->previous->pts + interval * 0.5;
                mid->pkt_duration = interval * 0.5;
                mid->nominal_fps = img->nominal_fps * 2;
                p->generated++;
                p->status = "active";
            }
        } else {
            p->failures++;
            p->failed = true;
            p->status = "allocation-failed";
        }
    } else
        p->status = "warming";
    if (p->failed) {
        reset(f);
        p->bypassed++;
        send(f, img);
        return;
    }
    // setrefp takes its own reference; a nested new_ref leaks a full float frame.
    mp_image_setrefp(&p->previous, img);
    img->pkt_duration = 1.0 / (img->nominal_fps * 2);
    img->nominal_fps *= 2;
    if (mid) {
        p->pending = img;
        send(f, mid);
    } else
        send(f, img);
}
static bool command(struct mp_filter *f, struct mp_filter_command *cmd) {
    if (cmd->type != MP_FILTER_COMMAND_GET_META)
        return false;
    struct priv *p = f->priv;
    struct mp_tags *tags = talloc_zero(NULL, struct mp_tags);
    mp_tags_set_str(tags, "status", p->status ? p->status : "waiting");
#define STAT(n) mp_tags_set_str(tags, #n, mp_tprintf(64, "%lld", (long long)p->n))
    STAT(inputs);
    STAT(outputs);
    STAT(generated);
    STAT(bypassed);
    STAT(resets);
    STAT(failures);
    mp_tags_set_str(tags, "inferenceMs", mp_tprintf(64, "%.3f", p->last_ms));
    mp_tags_set_str(tags, "playbackSpeed", mp_tprintf(64, "%.6f", playback_speed(p)));
    *(struct mp_tags **)cmd->res = tags;
    return true;
}
static const struct mp_filter_info info = {.name = "tigerest-rife",
                                           .priv_size = sizeof(struct priv),
                                           .process = process,
                                           .reset = reset,
                                           .destroy = destroy,
                                           .command = command};
static struct mp_filter *create(struct mp_filter *parent, void *options) {
    talloc_free(options);
    struct mp_filter *f = mp_filter_create(parent, &info);
    if (!f)
        return NULL;
    mp_filter_add_pin(f, MP_PIN_IN, "in");
    mp_filter_add_pin(f, MP_PIN_OUT, "out");
    struct priv *p = f->priv;
    p->opts = m_config_cache_alloc(p, f->global, &mp_opt_root);
    p->pool = mp_image_pool_new(p);
    p->download_pool = mp_image_pool_new(p);
    p->sws = mp_sws_alloc(p);
    p->sws->log = f->log;
    return f;
}
const struct mp_user_filter_entry vf_tigerest_rife = {
    .desc = {.name = "tigerest-rife", .description = "iPad Core ML RIFE 4.25 lite, 1080p SDR 2x"},
    .create = create};

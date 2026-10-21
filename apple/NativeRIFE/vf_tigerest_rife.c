// iPad adapter for mpv v0.41.0. Ownership and scheduling follow mpv filters.
// The output stays in mpv's timestamped video queue, ahead of subtitles/shaders.
#include "NativeRIFE.h"
#include "RifeColorConverter.h"
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
#ifdef TIGEREST_RIFE_TIMING
#include <time.h>
static double trace_ms(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec * 1000.0 + now.tv_nsec / 1000000.0;
}
static double trace_cpu_ms(void) {
    struct timespec now;
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &now);
    return now.tv_sec * 1000.0 + now.tv_nsec / 1000000.0;
}
#endif
struct priv {
    void *engine;
    void *color_converter;
    bool color_unavailable;
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
#ifdef TIGEREST_RIFE_TIMING
    double conversion_ms, pipeline_ms, pipeline_total_ms, pipeline_peak_ms;
    double download_ms, scale_ms, conversion_cpu_ms, pipeline_cpu_ms;
    int software_format;
    bool metal_conversion;
    int64_t pipeline_samples, pipeline_over_budget;
#endif
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
    tgrife_color_destroy(((struct priv *)f->priv)->color_converter);
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
#ifdef TIGEREST_RIFE_TIMING
    double download_start = trace_ms();
#endif
    // fmt describes the underlying NV12/P010 layout even for a hardware image.
    // Detect the surface using imgfmt, otherwise swscale receives VideoToolbox.
    struct mp_image *sw = IMGFMT_IS_HWACCEL(src->imgfmt)
                              ? mp_image_hw_download(src, p->download_pool)
                              : mp_image_new_ref(src);
#ifdef TIGEREST_RIFE_TIMING
    p->download_ms = trace_ms() - download_start;
#endif
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
#ifdef TIGEREST_RIFE_TIMING
        double scale_start = trace_ms();
        p->software_format = imgfmt2pixfmt(sw->imgfmt);
#endif
        // Only the measured BT.709 NV12/P010 paths use Metal. Other matrices,
        // ranges, chroma siting and pixel formats retain swscale's conversion.
        bool converted = false;
        const int chroma = sw->params.chroma_location;
        const bool p010 = sw->imgfmt == pixfmt2imgfmt(AV_PIX_FMT_P010);
        const bool nv12 = (p010 || sw->imgfmt == pixfmt2imgfmt(AV_PIX_FMT_NV12)) &&
            sw->params.repr.sys == PL_COLOR_SYSTEM_BT_709 &&
            (sw->params.repr.levels == PL_COLOR_LEVELS_FULL ||
             sw->params.repr.levels == PL_COLOR_LEVELS_LIMITED) &&
            (chroma == PL_CHROMA_UNKNOWN || chroma == PL_CHROMA_LEFT || chroma == PL_CHROMA_CENTER);
        if (nv12 && !p->color_unavailable) {
            if (!p->color_converter)
                p->color_converter = tgrife_color_create(sw->w, sw->h);
            if (p->color_converter)
                converted = tgrife_color_convert(p->color_converter, sw->planes[0], sw->stride[0],
                    sw->planes[1], sw->stride[1], (float **)rgb->planes, rgb->stride,
                    sw->params.repr.levels == PL_COLOR_LEVELS_FULL,
                    chroma == PL_CHROMA_CENTER ||
                    (chroma == PL_CHROMA_UNKNOWN && sw->params.repr.levels == PL_COLOR_LEVELS_FULL),
                    p010);
            if (!converted) {
                // Fall back on this frame and avoid repeating a failed GPU
                // setup/command on every subsequent source frame.
                tgrife_color_destroy(p->color_converter);
                p->color_converter = NULL;
                p->color_unavailable = true;
            }
        }
#ifdef TIGEREST_RIFE_TIMING
        p->metal_conversion = converted;
#endif
        if (!converted && mp_sws_scale(p->sws, rgb, sw) < 0) {
            p->status = "swscale-failed";
            mp_image_unrefp(&rgb);
        }
#ifdef TIGEREST_RIFE_TIMING
        p->scale_ms = trace_ms() - scale_start;
#endif
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
#ifdef TIGEREST_RIFE_TIMING
    const double pipeline_start = trace_ms();
    const double pipeline_cpu_start = trace_cpu_ms();
#endif
    struct mp_image *img = convert(f, input);
#ifdef TIGEREST_RIFE_TIMING
    p->conversion_ms = trace_ms() - pipeline_start;
    p->conversion_cpu_ms = trace_cpu_ms() - pipeline_cpu_start;
#endif
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
#ifdef TIGEREST_RIFE_TIMING
        p->pipeline_ms = trace_ms() - pipeline_start;
        p->pipeline_cpu_ms = trace_cpu_ms() - pipeline_cpu_start;
        p->pipeline_total_ms += p->pipeline_ms;
        p->pipeline_peak_ms = fmax(p->pipeline_peak_ms, p->pipeline_ms);
        p->pipeline_samples++;
        if (p->pipeline_ms > interval * 1000.0) p->pipeline_over_budget++;
#endif
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
#ifdef TIGEREST_RIFE_TIMING
#define TIMING(key, member) mp_tags_set_str(tags, key, mp_tprintf(64, "%.3f", p->member))
    TIMING("conversionMs", conversion_ms);
    TIMING("downloadMs", download_ms);
    TIMING("scaleMs", scale_ms);
    TIMING("conversionCPUMs", conversion_cpu_ms);
    TIMING("pipelineCPUMs", pipeline_cpu_ms);
    STAT(software_format);
    mp_tags_set_str(tags, "colorBackend", p->metal_conversion ? "metal" : "swscale");
    TIMING("pipelineMs", pipeline_ms);
    TIMING("pipelineTotalMs", pipeline_total_ms);
    TIMING("pipelinePeakMs", pipeline_peak_ms);
    STAT(pipeline_samples);
    STAT(pipeline_over_budget);
#undef TIMING
#endif
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
const struct mp_user_filter_entry vf_tigerest_rife_core = {
    .desc = {.name = "tigerest-rife", .description = "iPad Core ML RIFE 4.25 lite, 1080p SDR 2x"},
    .create = create};

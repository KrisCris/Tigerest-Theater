#include "native_rife_fixture.h"
#include "../NativeRIFE/NativeRIFE.h"
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct fx_metrics fx;
struct mpv_global fx_global;
const struct m_sub_options mp_opt_root = {0};
union allocation {
    max_align_t alignment;
    struct {
        union allocation *parent, *child, *next, *previous;
        void (*destructor)(void *);
    } h;
};
struct fx_pixels { int references; float samples[3]; };

void *fx_alloc(void *parent, size_t size) {
    union allocation *node = calloc(1, sizeof(*node) + size);
    assert(node);
    if (parent) {
        node->h.parent = (union allocation *)parent - 1;
        node->h.next = node->h.parent->h.child;
        if (node->h.next) node->h.next->h.previous = node;
        node->h.parent->h.child = node;
    }
    fx.allocations++;
    return node + 1;
}
void talloc_free(void *pointer) {
    if (!pointer) return;
    union allocation *node = (union allocation *)pointer - 1;
    if (node->h.destructor) node->h.destructor(pointer);
    while (node->h.child) talloc_free(node->h.child + 1);
    if (node->h.previous) node->h.previous->h.next = node->h.next;
    else if (node->h.parent) node->h.parent->h.child = node->h.next;
    if (node->h.next) node->h.next->h.previous = node->h.previous;
    fx.allocations--;
    free(node);
}
static void image_destructor(void *pointer) {
    struct mp_image *image = pointer;
    if (--image->pixels->references == 0) { free(image->pixels); fx.pixels--; }
    fx.images--;
}
static struct mp_image *new_image(void) {
    struct mp_image *image = talloc_zero(NULL, struct mp_image);
    ((union allocation *)image - 1)->h.destructor = image_destructor;
    fx.images++;
    if (fx.images > fx.peak_images) fx.peak_images = fx.images;
    return image;
}
struct mp_image *mp_image_pool_get(struct mp_image_pool *pool, int format, int w, int h) {
    (void)pool;
    struct mp_image *image = new_image();
    image->w = w; image->h = h; image->imgfmt = format;
    image->params.imgfmt = format; image->params.w = w; image->params.h = h;
    image->pixels = calloc(1, sizeof(*image->pixels));
    assert(image->pixels); image->pixels->references = 1;
    fx.pixels++; if (fx.pixels > fx.peak_pixels) fx.peak_pixels = fx.pixels;
    for (int c = 0; c < 3; c++) {
        image->planes[c] = (unsigned char *)&image->pixels->samples[c];
        image->stride[c] = sizeof(float);
    }
    return image;
}
struct mp_image *fx_image(double pts, double fps, float pixel, bool hardware) {
    struct mp_image *image = mp_image_pool_get(NULL, hardware ? FX_HARDWARE : FX_SOFTWARE, 1920, 1080);
    image->pts = pts; image->nominal_fps = fps; image->pkt_duration = 1 / fps;
    image->params.color.primaries = PL_COLOR_PRIM_BT_709;
    image->params.color.transfer = PL_COLOR_TRC_BT_1886;
    for (int c = 0; c < 3; c++) image->pixels->samples[c] = pixel;
    return image;
}
struct mp_image *mp_image_new_ref(struct mp_image *image) {
    if (!image) return NULL;
    struct mp_image *copy = new_image(); *copy = *image;
    copy->pixels->references++;
    return copy;
}
void mp_image_unrefp(struct mp_image **image) { talloc_free(*image); *image = NULL; }
void mp_image_setrefp(struct mp_image **target, struct mp_image *source) {
    if (*target != source) { talloc_free(*target); *target = mp_image_new_ref(source); }
}
void mp_image_copy_attributes(struct mp_image *target, struct mp_image *source) {
    target->pts = source->pts; target->nominal_fps = source->nominal_fps;
    target->pkt_duration = source->pkt_duration; target->fields = source->fields;
    target->params.color = source->params.color; target->params.repr = source->params.repr;
}
bool mp_image_params_static_equal(const struct mp_image_params *a, const struct mp_image_params *b) {
    return memcmp(a, b, sizeof(*a)) == 0;
}
struct mp_image *mp_image_hw_download(struct mp_image *source, struct mp_image_pool *pool) {
    (void)pool; assert(source->imgfmt == FX_HARDWARE); fx.downloads++;
    struct mp_image *image = mp_image_new_ref(source);
    image->imgfmt = image->params.imgfmt = FX_SOFTWARE;
    return image;
}
struct mp_image_pool *mp_image_pool_new(void *parent) { return talloc_zero(parent, struct mp_image_pool); }
struct mp_sws_context *mp_sws_alloc(void *parent) { return talloc_zero(parent, struct mp_sws_context); }
int mp_sws_scale(struct mp_sws_context *sws, struct mp_image *target, struct mp_image *source) {
    (void)sws; assert(source->imgfmt != FX_HARDWARE); fx.conversions++;
    memcpy(target->pixels->samples, source->pixels->samples, sizeof(target->pixels->samples));
    return 0;
}
int pixfmt2imgfmt(int format) { return format; }
int imgfmt2pixfmt(int format) { return format; }
struct mp_filter *mp_filter_create(struct mp_filter *parent, const struct mp_filter_info *info) {
    struct mp_filter *filter = talloc_zero(parent, struct mp_filter);
    filter->priv = fx_alloc(filter, info->priv_size); filter->info = info;
    filter->global = &fx_global;
    return filter;
}
void mp_filter_add_pin(struct mp_filter *filter, int direction, const char *name) {
    (void)direction; (void)name;
    assert(filter->num_pins < 2);
    filter->ppins[filter->num_pins++] = talloc_zero(filter, struct mp_pin);
}
bool mp_pin_in_needs_data(struct mp_pin *pin) { return pin->needs_data && pin->frame.type == MP_FRAME_NONE; }
struct mp_frame mp_pin_out_read(struct mp_pin *pin) {
    struct mp_frame frame = pin->frame; pin->frame = (struct mp_frame){0};
    if (frame.type) pin->reads++;
    return frame;
}
void mp_pin_in_write(struct mp_pin *pin, struct mp_frame frame) {
    assert(mp_pin_in_needs_data(pin)); pin->frame = frame; pin->needs_data = false;
}
void fx_push(struct mp_filter *filter, struct mp_frame frame) {
    assert(filter->ppins[0]->frame.type == MP_FRAME_NONE);
    filter->ppins[0]->frame = frame;
}
struct mp_frame fx_pull(struct mp_filter *filter) {
    struct mp_pin *out = filter->ppins[1]; out->needs_data = true;
    filter->info->process(filter);
    struct mp_frame frame = out->frame; out->frame = (struct mp_frame){0}; out->needs_data = false;
    return frame;
}
void fx_release(struct mp_frame frame) { if (frame.type == MP_FRAME_VIDEO) talloc_free(frame.data); }
void fx_seek(struct mp_filter *filter) {
    for (int i = 0; i < 2; i++) {
        fx_release(filter->ppins[i]->frame); filter->ppins[i]->frame = (struct mp_frame){0};
        filter->ppins[i]->needs_data = false;
    }
    filter->info->reset(filter);
}
void fx_destroy_filter(struct mp_filter *filter) {
    fx_seek(filter); filter->info->destroy(filter); talloc_free(filter);
}
void fx_begin(void) {
    assert(fx.allocations == 0 && fx.images == 0 && fx.pixels == 0 && fx.creates == fx.destroys);
    fx = (struct fx_metrics){0}; fx_global.opts.playback_speed = 1;
}
const char *fx_printf(int size, const char *format, ...) {
    (void)size;
    static char buffers[32][128]; static unsigned next;
    char *result = buffers[next++ % 32];
    va_list args; va_start(args, format); vsnprintf(result, 128, format, args); va_end(args);
    return result;
}
void mp_tags_set_str(struct mp_tags *tags, const char *key, const char *value) {
    assert(tags->count < 24); int i = tags->count++;
    snprintf(tags->keys[i], sizeof(tags->keys[i]), "%s", key);
    snprintf(tags->values[i], sizeof(tags->values[i]), "%s", value);
}
const char *fx_tag(struct mp_tags *tags, const char *key) {
    for (int i = 0; i < tags->count; i++) if (!strcmp(tags->keys[i], key)) return tags->values[i];
    return "";
}
struct m_config_cache *m_config_cache_alloc(void *parent, struct mpv_global *global, const struct m_sub_options *group) {
    assert(group == &mp_opt_root);
    struct m_config_cache *cache = talloc_zero(parent, struct m_config_cache);
    cache->global = global; cache->opts = talloc_zero(cache, struct MPOpts);
    *(struct MPOpts *)cache->opts = global->opts;
    return cache;
}
bool m_config_cache_update(struct m_config_cache *cache) {
    struct MPOpts *opts = cache->opts;
    bool changed = opts->playback_speed != cache->global->opts.playback_speed;
    *opts = cache->global->opts;
    return changed;
}
void *tgrife_create(void) { fx.creates++; return fx_alloc(NULL, 1); }
void tgrife_destroy(void *engine) { if (engine) { fx.destroys++; talloc_free(engine); } }
void tgrife_reset(void *engine) { if (engine) fx.resets++; }
void *tgrife_color_create(int w, int h) {
    assert(w == 1920 && h == 1080); fx.color_creates++;
    return fx.fail_color_create ? NULL : fx_alloc(NULL, 1);
}
void tgrife_color_destroy(void *converter) {
    if (converter) { fx.color_destroys++; talloc_free(converter); }
}
int tgrife_color_convert(void *converter, const uint8_t *y, int ys, const uint8_t *uv,
                        int uvs, float *out[3], const int strides[3], int full, int centered,
                        int p010) {
    (void)uv; (void)uvs;
    assert(converter && ys == sizeof(float) && strides[0] == sizeof(float));
    assert((full == 0 || full == 1) && (centered == 0 || centered == 1) && (p010 == 0 || p010 == 1));
    fx.color_conversions++;
    fx.color_full_range = full; fx.color_centered = centered; fx.color_p010 = p010;
    if (fx.fail_color_convert) return 0;
    for (int p = 0; p < 3; p++) out[p][0] = *(const float *)y;
    return 1;
}
int tgrife_interpolate(void *engine, const float *a[3], const int as[3], const float *b[3],
                      const int bs[3], float *out[3], const int os[3], uint64_t generation,
                      int64_t index, double *milliseconds) {
    assert(engine && as[0] == sizeof(float) && bs[0] == sizeof(float) && os[0] == sizeof(float));
    fx.interpolations++; fx.last_generation = generation; fx.last_index = index;
    fx.last_a = a[0][0]; fx.last_b = b[0][0];
    if (fx.fail_next_inference) { fx.fail_next_inference = false; return 0; }
    for (int c = 0; c < 3; c++) out[c][0] = (a[c][0] + b[c][0]) * .5f;
    *milliseconds = 1;
    return 1;
}

#ifndef TIGEREST_NATIVE_RIFE_FIXTURE_H
#define TIGEREST_NATIVE_RIFE_FIXTURE_H

// Host scheduling fixture, not a replacement mpv ABI. The runner supplies these
// declarations only while compiling the actual production filter for this test.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum { MP_FRAME_NONE, MP_FRAME_VIDEO, MP_FRAME_EOF };
enum { MP_PIN_IN, MP_PIN_OUT };
enum { MP_FILTER_COMMAND_TEXT = 1, MP_FILTER_COMMAND_GET_META,
       MP_FILTER_COMMAND_SET_SPEED, MP_FILTER_COMMAND_SET_SPEED_RESAMPLE,
       MP_FILTER_COMMAND_SET_SPEED_DROP, MP_FILTER_COMMAND_IS_ACTIVE };
enum { PL_COLOR_PRIM_BT_709 = 1, PL_COLOR_TRC_BT_1886 = 2,
       PL_COLOR_TRC_SRGB = 3, PL_COLOR_SYSTEM_RGB = 4,
       PL_COLOR_SYSTEM_DOLBYVISION = 5, PL_COLOR_LEVELS_FULL = 6,
       PL_COLOR_SYSTEM_BT_709 = 7, PL_COLOR_LEVELS_LIMITED = 8 };
enum { PL_CHROMA_UNKNOWN, PL_CHROMA_LEFT, PL_CHROMA_CENTER, PL_CHROMA_TOP_LEFT };
enum { AV_PIX_FMT_GBRPF32 = 10, FX_SOFTWARE = 11, FX_HARDWARE = 12,
       AV_PIX_FMT_NV12 = 13, AV_PIX_FMT_P010 = 14, MP_IMGFIELD_INTERLACED = 1 };
#define MP_NOPTS_VALUE (-1e20)
#define IMGFMT_IS_HWACCEL(format) ((format) == FX_HARDWARE)

struct pl_bit_encoding { int sample_depth, color_depth, bit_shift; };
struct mp_image_params {
    int imgfmt, w, h, chroma_location;
    struct { int primaries, transfer; } color;
    struct { int sys, levels; struct pl_bit_encoding bits; } repr;
};
struct fx_pixels;
struct mp_image {
    int w, h, imgfmt, fields;
    double pts, pkt_duration, nominal_fps;
    struct mp_image_params params;
    unsigned char *planes[3];
    int stride[3];
    struct fx_pixels *pixels;
};
struct mp_frame { int type; void *data; };
#define MAKE_FRAME(kind, image) ((struct mp_frame){(kind), (image)})
struct mp_pin { bool needs_data; struct mp_frame frame; unsigned reads; };
struct mp_filter_command {
    int type;
    const char *target, *cmd, *arg;
    void *res;
    double speed;
    bool is_active;
};
struct MPOpts { double playback_speed; };
struct mpv_global { struct MPOpts opts; };
struct m_sub_options { int unused; };
extern const struct m_sub_options mp_opt_root;
struct m_config_cache { void *opts; struct mpv_global *global; };
struct mp_filter;
struct mp_filter_info {
    const char *name;
    size_t priv_size;
    void (*process)(struct mp_filter *);
    void (*reset)(struct mp_filter *);
    void (*destroy)(struct mp_filter *);
    bool (*command)(struct mp_filter *, struct mp_filter_command *);
};
struct mp_filter {
    void *priv, *log;
    struct mpv_global *global;
    struct mp_pin *ppins[2];
    int num_pins;
    const struct mp_filter_info *info;
};
struct mp_user_filter_entry {
    struct { const char *name, *description; } desc;
    struct mp_filter *(*create)(struct mp_filter *, void *);
};
struct mp_image_pool { int unused; };
struct mp_sws_context { void *log; };
struct mp_tags { int count; char keys[24][32], values[24][128]; };

void *fx_alloc(void *parent, size_t size);
void talloc_free(void *pointer);
#define talloc_zero(parent, type) ((type *)fx_alloc((parent), sizeof(type)))
const char *fx_printf(int size, const char *format, ...);
#define mp_tprintf(size, ...) fx_printf((size), __VA_ARGS__)
struct mp_filter *mp_filter_create(struct mp_filter *, const struct mp_filter_info *);
void mp_filter_add_pin(struct mp_filter *, int, const char *);
bool mp_pin_in_needs_data(struct mp_pin *);
struct mp_frame mp_pin_out_read(struct mp_pin *);
void mp_pin_in_write(struct mp_pin *, struct mp_frame);
struct mp_image_pool *mp_image_pool_new(void *);
struct mp_image *mp_image_pool_get(struct mp_image_pool *, int, int, int);
struct mp_image *mp_image_new_ref(struct mp_image *);
void mp_image_setrefp(struct mp_image **, struct mp_image *);
void mp_image_unrefp(struct mp_image **);
void mp_image_copy_attributes(struct mp_image *, struct mp_image *);
bool mp_image_params_static_equal(const struct mp_image_params *, const struct mp_image_params *);
struct mp_image *mp_image_hw_download(struct mp_image *, struct mp_image_pool *);
struct mp_sws_context *mp_sws_alloc(void *);
int mp_sws_scale(struct mp_sws_context *, struct mp_image *, struct mp_image *);
int pixfmt2imgfmt(int);
int imgfmt2pixfmt(int);
void mp_tags_set_str(struct mp_tags *, const char *, const char *);
struct m_config_cache *m_config_cache_alloc(void *, struct mpv_global *, const struct m_sub_options *);
bool m_config_cache_update(struct m_config_cache *);

struct fx_metrics {
    int allocations, images, pixels, peak_images, peak_pixels;
    int creates, destroys, resets, interpolations, downloads, conversions;
    bool fail_next_inference;
    bool fail_color_create, fail_color_convert;
    int color_creates, color_destroys, color_conversions;
    int color_full_range, color_centered, color_p010;
    uint64_t last_generation;
    int64_t last_index;
    float last_a, last_b;
};
extern struct fx_metrics fx;
extern struct mpv_global fx_global;
void fx_begin(void);
struct mp_image *fx_image(double pts, double fps, float pixel, bool hardware);
void fx_push(struct mp_filter *, struct mp_frame);
struct mp_frame fx_pull(struct mp_filter *);
void fx_release(struct mp_frame);
void fx_seek(struct mp_filter *);
void fx_destroy_filter(struct mp_filter *);
const char *fx_tag(struct mp_tags *, const char *);

#endif

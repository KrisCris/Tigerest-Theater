#include "RifeColorConverter.h"
extern "C" {
#include <libswscale/swscale.h>
#include <libavutil/opt.h>
}
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

static void compare(int w, int h, bool full, bool centered, bool random, bool padded) {
    const int input_stride = w + (padded ? 16 : 0);
    const int output_stride = w + (padded ? 8 : 0);
    std::vector<uint8_t> y(input_stride * h + 64), uv(input_stride * h / 2 + 64);
    unsigned rng = 781;
    auto next = [&] { rng = 1664525 * rng + 1013904223; return uint8_t(rng >> 24); };
    for (int row = 0; row < h; row++) for (int x = 0; x < w; x++)
        y[row * input_stride + x] = random ? next() : (x * 255 / (w - 1));
    for (int row = 0; row < h / 2; row++) for (int x = 0; x < w; x++)
        uv[row * input_stride + x] = random ? next() : (row * 255 / std::max(1, h / 2 - 1));
    std::vector<float> expected[3], actual[3];
    uint8_t *dst[4] = {}; float *out[3];
    int strides[4] = {output_stride * 4, output_stride * 4, output_stride * 4, 0};
    for (int p = 0; p < 3; p++) {
        expected[p].resize(output_stride * h + 16, -3);
        actual[p].resize(output_stride * h + 16, -3);
        dst[p] = (uint8_t *)expected[p].data(); out[p] = actual[p].data();
    }
    auto s = sws_alloc_context(); assert(s);
    av_opt_set_int(s, "srcw", w, 0); av_opt_set_int(s, "srch", h, 0);
    av_opt_set_int(s, "dstw", w, 0); av_opt_set_int(s, "dsth", h, 0);
    av_opt_set_int(s, "src_format", AV_PIX_FMT_NV12, 0);
    av_opt_set_int(s, "dst_format", AV_PIX_FMT_GBRPF32, 0);
    av_opt_set_int(s, "sws_flags", SWS_BILINEAR, 0);
    av_opt_set_int(s, "src_h_chr_pos", centered ? 128 : 0, 0);
    av_opt_set_int(s, "src_v_chr_pos", 128, 0);
    sws_setColorspaceDetails(s, sws_getCoefficients(SWS_CS_ITU709), full,
                            sws_getCoefficients(SWS_CS_DEFAULT), 1, 0, 1 << 16, 1 << 16);
    assert(sws_init_context(s, nullptr, nullptr) >= 0);
    const uint8_t *src[4] = {y.data(), uv.data(), nullptr, nullptr};
    int src_strides[4] = {input_stride, input_stride, 0, 0};
    assert(sws_scale(s, src, src_strides, 0, h, dst, strides) == h);
    void *converter = tgrife_color_create(w, h); assert(converter);
    assert(tgrife_color_convert(converter, y.data(), input_stride, uv.data(), input_stride,
                               out, strides, full, centered));
    double peak = 0, sum = 0;
    for (int p = 0; p < 3; p++) for (int row = 0; row < h; row++) {
        for (int x = 0; x < w; x++) {
            const int i = row * output_stride + x;
            assert(std::isfinite(actual[p][i]) && actual[p][i] >= 0 && actual[p][i] <= 1);
            double diff = std::abs(actual[p][i] - expected[p][i]);
            peak = std::max(peak, diff); sum += diff;
        }
        for (int x = w; x < output_stride; x++) assert(actual[p][row * output_stride + x] == -3);
    }
    for (int p = 0; p < 3; p++) for (int x = output_stride * h; x < output_stride * h + 16; x++)
        assert(actual[p][x] == -3);
    printf("%dx%d range=%d centered=%d random=%d padded=%d: max=%.8f mean=%.8f\n",
           w, h, full, centered, random, padded, peak, sum / (3 * w * h)); fflush(stdout);
    // Keep the pinned swscale normalization, allowing only fixed-point rounding.
    assert(peak < 1.0 / 4096);
    assert(!tgrife_color_convert(converter, y.data(), w - 1, uv.data(), input_stride,
                                out, strides, full, centered));
    assert(!tgrife_color_convert(converter, y.data(), input_stride, nullptr, input_stride,
                                out, strides, full, centered));
    assert(!tgrife_color_convert(converter, y.data(), input_stride, uv.data(), input_stride,
                                out, strides, 2, centered));
    tgrife_color_destroy(converter); sws_freeContext(s);
}
int main() {
    assert(!tgrife_color_create(0, 1080)); assert(!tgrife_color_create(17, 8));
    assert(!tgrife_color_create(3840, 2160)); tgrife_color_destroy(nullptr);
    assert(!tgrife_color_convert(nullptr, nullptr, 0, nullptr, 0, nullptr, nullptr, 0, 0));
    for (int full = 0; full < 2; full++) for (int centered = 0; centered < 2; centered++)
        for (int random = 0; random < 2; random++) for (int padded = 0; padded < 2; padded++)
            compare(32, 16, full, centered, random, padded);
    compare(1920, 1080, false, false, true, true);
    puts("Metal/swscale pixel comparison and invalid-input checks passed.");
}

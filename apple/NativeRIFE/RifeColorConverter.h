#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Single-worker, reusable NV12/P010 BT.709 -> planar GBR float converter. Returns
// zero on unsupported input or Metal failure so the caller can use swscale.
void *tgrife_color_create(int width, int height);
void tgrife_color_destroy(void *converter);
int tgrife_color_convert(void *converter, const uint8_t *y, int y_stride,
                        const uint8_t *uv, int uv_stride, float *out[3],
                        const int strides[3], int full_range, int centered_chroma,
                        int p010);
#ifdef __cplusplus
}
#endif

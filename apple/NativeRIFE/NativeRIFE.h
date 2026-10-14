#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
void *tgrife_create(void);
void tgrife_destroy(void *engine);
void tgrife_reset(void *engine);
int tgrife_interpolate(void *engine, const float *a[3], const int as[3], const float *b[3],
                       const int bs[3], float *out[3], const int os[3], uint64_t generation,
                       int64_t index, double *milliseconds);
#ifdef __cplusplus
}
#endif

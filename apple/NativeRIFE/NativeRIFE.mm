#include "NativeRIFE.h"
#include "RifeEngine.h"
#import <Foundation/Foundation.h>
#include <cstring>
using rife::RifeEngine;
extern "C" void *tgrife_create(void) {
    @autoreleasepool {
        try {
            NSString *path = [[NSBundle mainBundle] pathForResource:@"RifeModel" ofType:nil];
            if (!path)
                return nullptr;
            rife::EngineConfig config;
            config.modelDirectory = path.UTF8String;
            config.width = 1920;
            config.height = 1080;
            config.pipeline = rife::Pipeline::SplitCoarseMetal;
            // Keep encoder/refine off the GPU used by Metal motion/warp and mpv.
            config.computePolicy = rife::ComputePolicy::CPUAndNeuralEngine;
            return RifeEngine::create(config).release();
        } catch (...) {
            return nullptr;
        }
    }
}
extern "C" void tgrife_destroy(void *engine) { delete static_cast<RifeEngine *>(engine); }
extern "C" void tgrife_reset(void *engine) {
    if (engine)
        static_cast<RifeEngine *>(engine)->reset();
}
extern "C" int tgrife_interpolate(void *engine, const float *a[3], const int as[3],
                                  const float *b[3], const int bs[3], float *out[3],
                                  const int os[3], uint64_t generation, int64_t index,
                                  double *milliseconds) {
    @autoreleasepool {
        try {
            rife::FrameView x{}, y{};
            x.width = y.width = 1920;
            x.height = y.height = 1080;
            // mpv/FFmpeg float planes are GBR; the model requires RGB.
            const int rgb[3] = {2, 0, 1};
            for (int c = 0; c < 3; c++) {
                x.planes[c] = a[rgb[c]];
                y.planes[c] = b[rgb[c]];
                x.strides[c] = as[rgb[c]];
                y.strides[c] = bs[rgb[c]];
            }
            x.identity = {generation, index - 1};
            y.identity = {generation, index};
            auto result = static_cast<RifeEngine *>(engine)->interpolate(x, y, 0.5f);
            for (int c = 0; c < 3; c++)
                for (int row = 0; row < 1080; row++)
                    memcpy((char *)out[rgb[c]] + row * os[rgb[c]],
                           result.pixels.data() + c * 1920 * 1080 + row * 1920,
                           1920 * sizeof(float));
            *milliseconds = result.inferenceMs;
            return 1;
        } catch (...) {
            return 0;
        }
    }
}

#include "RifeColorConverter.h"
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <cstring>
#include <new>

namespace {
constexpr const char *source = R"metal(
#include <metal_stdlib>
using namespace metal;
struct Parameters { uint width, height, full, centered; };
// NV12 bytes and P010 16-bit samples (10 bits in the high bits) both reach
// this as 8-bit-scaled code values, so ranges and offsets stay the 8-bit ones.
template <typename Y, typename UV>
inline void yuv_to_gbr(device const Y *y, device const UV *uv, device float *out,
                       constant Parameters &p, uint2 xy, float scale) {
    if (xy.x >= p.width || xy.y >= p.height) return;
    float2 coord = float2((float(xy.x) - (p.centered ? 0.5f : 0.0f)) * 0.5f,
                         (float(xy.y) - 0.5f) * 0.5f);
    coord = clamp(coord, float2(0), float2(p.width / 2 - 1, p.height / 2 - 1));
    uint2 a = uint2(coord), b = min(a + 1, uint2(p.width / 2 - 1, p.height / 2 - 1));
    float2 weight = fract(coord);
    float2 top = mix(float2(uv[a.y * (p.width / 2) + a.x]),
                     float2(uv[a.y * (p.width / 2) + b.x]), weight.x);
    float2 bottom = mix(float2(uv[b.y * (p.width / 2) + a.x]),
                        float2(uv[b.y * (p.width / 2) + b.x]), weight.x);
    // Match the existing swscale GBRPF32 path's 8-bit values shifted into
    // 16-bit storage, then normalized by 65535 (65280 / 65535 = 256 / 257).
    // Apply before clipping, including super-white/chroma excursions.
    const float gain = 256.0f / 257.0f;
    float2 chroma = (mix(top, bottom, weight.y) * scale - 128.0f) * gain / (p.full ? 255.0f : 224.0f);
    uint i = xy.y * p.width + xy.x, count = p.width * p.height;
    float luma = (float(y[i]) * scale - (p.full ? 0.0f : 16.0f)) * gain / (p.full ? 255.0f : 219.0f);
    out[i] = clamp(luma - 0.187324273f * chroma.x - 0.468124273f * chroma.y, 0.0f, 1.0f);
    out[count + i] = clamp(luma + 1.8556f * chroma.x, 0.0f, 1.0f);
    out[2 * count + i] = clamp(luma + 1.5748f * chroma.y, 0.0f, 1.0f);
}
kernel void nv12_to_gbr(device const uchar *y [[buffer(0)]],
                        device const uchar2 *uv [[buffer(1)]],
                        device float *out [[buffer(2)]],
                        constant Parameters &p [[buffer(3)]],
                        uint2 xy [[thread_position_in_grid]]) {
    yuv_to_gbr(y, uv, out, p, xy, 1.0f);
}
kernel void p010_to_gbr(device const ushort *y [[buffer(0)]],
                        device const ushort2 *uv [[buffer(1)]],
                        device float *out [[buffer(2)]],
                        constant Parameters &p [[buffer(3)]],
                        uint2 xy [[thread_position_in_grid]]) {
    yuv_to_gbr(y, uv, out, p, xy, 1.0f / 256.0f);
}
)metal";
struct Converter {
    int width, height;
    id<MTLCommandQueue> queue;
    id<MTLComputePipelineState> pipeline, p010_pipeline;
    id<MTLBuffer> y, uv, output;
};
}

void *tgrife_color_create(int width, int height) {
    if (width <= 0 || height <= 0 || width > 1920 || height > 1080 ||
        (width & 1) || (height & 1)) return nullptr;
    @autoreleasepool {
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        if (!device) return nullptr;
        NSError *error = nil;
        id<MTLLibrary> library = [device newLibraryWithSource:[NSString stringWithUTF8String:source]
                                                    options:nil error:&error];
        if (!library) return nullptr;
        id<MTLFunction> function = [library newFunctionWithName:@"nv12_to_gbr"];
        id<MTLFunction> p010 = [library newFunctionWithName:@"p010_to_gbr"];
        if (!function || !p010) return nullptr;
        auto *c = new (std::nothrow) Converter{};
        if (!c) return nullptr;
        c->width = width; c->height = height;
        c->queue = [device newCommandQueue];
        c->pipeline = [device newComputePipelineStateWithFunction:function error:&error];
        c->p010_pipeline = [device newComputePipelineStateWithFunction:p010 error:&error];
        // Sized for P010's 16-bit samples; NV12 uses the first half.
        const size_t count = (size_t)width * height;
        c->y = [device newBufferWithLength:count * 2 options:MTLResourceStorageModeShared];
        c->uv = [device newBufferWithLength:count options:MTLResourceStorageModeShared];
        c->output = [device newBufferWithLength:count * 3 * sizeof(float) options:MTLResourceStorageModeShared];
        if (!c->queue || !c->pipeline || !c->p010_pipeline || !c->y || !c->uv || !c->output) {
            delete c; return nullptr;
        }
        return c;
    }
}
void tgrife_color_destroy(void *converter) { delete static_cast<Converter *>(converter); }
int tgrife_color_convert(void *converter, const uint8_t *y, int ys, const uint8_t *uv, int uvs,
                        float *out[3], const int strides[3], int full, int centered, int p010) {
    auto *c = static_cast<Converter *>(converter);
    if (!c || (p010 != 0 && p010 != 1)) return 0;
    const size_t row_bytes = (size_t)c->width * (p010 ? 2 : 1);
    if (!y || !uv || !out || !strides || ys < (int)row_bytes || uvs < (int)row_bytes ||
        (full != 0 && full != 1) || (centered != 0 && centered != 1)) return 0;
    for (int p = 0; p < 3; p++)
        if (!out[p] || strides[p] < c->width * (int)sizeof(float) || strides[p] % sizeof(float)) return 0;
    @autoreleasepool {
        const size_t w = c->width, h = c->height, count = w * h;
        for (size_t row = 0; row < h; row++)
            memcpy((uint8_t *)c->y.contents + row * row_bytes, y + row * ys, row_bytes);
        for (size_t row = 0; row < h / 2; row++)
            memcpy((uint8_t *)c->uv.contents + row * row_bytes, uv + row * uvs, row_bytes);
        id<MTLCommandBuffer> command = [c->queue commandBuffer];
        id<MTLComputeCommandEncoder> encoder = [command computeCommandEncoder];
        if (!command || !encoder) return 0;
        id<MTLComputePipelineState> pipeline = p010 ? c->p010_pipeline : c->pipeline;
        [encoder setComputePipelineState:pipeline];
        [encoder setBuffer:c->y offset:0 atIndex:0];
        [encoder setBuffer:c->uv offset:0 atIndex:1];
        [encoder setBuffer:c->output offset:0 atIndex:2];
        const uint32_t params[] = {(uint32_t)w, (uint32_t)h, (uint32_t)full, (uint32_t)centered};
        [encoder setBytes:params length:sizeof(params) atIndex:3];
        const NSUInteger groupWidth = pipeline.threadExecutionWidth;
        [encoder dispatchThreads:MTLSizeMake(w, h, 1)
            threadsPerThreadgroup:MTLSizeMake(groupWidth, 4, 1)];
        [encoder endEncoding]; [command commit]; [command waitUntilCompleted];
        if (command.status != MTLCommandBufferStatusCompleted) return 0;
        const float *pixels = (const float *)c->output.contents;
        for (size_t p = 0; p < 3; p++) for (size_t row = 0; row < h; row++)
            memcpy((uint8_t *)out[p] + row * strides[p], pixels + p * count + row * w, w * sizeof(float));
        return 1;
    }
}

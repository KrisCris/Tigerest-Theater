#pragma once
#import <CoreML/CoreML.h>
#include <memory>

namespace rife {
// Private, serialized final stage. Owns shared full-frame input/output buffers.
class MetalWarp final {
public:
    static std::unique_ptr<MetalWarp> create(int width,int height,int lowWidth,int lowHeight);
    ~MetalWarp();
    MLMultiArray* input(int slot) const;
    MLPredictionOptions* coarseOptions() const;
    MLPredictionOptions* refineOptions() const;
    unsigned directBufferCount() const;
    MLMultiArray* predict(MLMultiArray* coarse,MLMultiArray* delta,MLMultiArray* mask,int first,int second);
private:
    struct Impl;
    explicit MetalWarp(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> m_impl;
};
}

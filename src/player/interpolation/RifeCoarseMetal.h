#pragma once
#import <CoreML/CoreML.h>
#include <memory>

namespace rife {
// Experimental serialized spatial stages. Conv models retain FP32 arithmetic.
class CoarseMetal final {
public:
    static std::unique_ptr<CoarseMetal> create(int width,int height);
    ~CoarseMetal();
    void begin(MLMultiArray* low0,MLMultiArray* low1,MLMultiArray* features0,MLMultiArray* features1);
    MLMultiArray* pack(int stage);
    MLPredictionOptions* options(int stage) const;
    void accept(int stage,MLMultiArray* output);
    MLMultiArray* flow() const;
private:
    struct Impl;
    explicit CoarseMetal(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> m_impl;
};
}

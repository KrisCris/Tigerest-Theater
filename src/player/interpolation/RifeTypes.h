#pragma once
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace rife {
enum class ComputePolicy { All, CPUAndGPU, CPUAndNeuralEngine };
enum class Pipeline { Monolithic, SplitEncoderRefine, SplitEncoderRefineMetal };
enum class ErrorCode { InvalidConfiguration, InvalidFrame, Busy, ModelLoad, Inference, NonFinite };

class EngineError : public std::runtime_error {
public:
    EngineError(ErrorCode code, const std::string& message) : std::runtime_error(message), m_code(code) {}
    ErrorCode code() const noexcept { return m_code; }
private:
    ErrorCode m_code;
};

// IDs refer to immutable frame content. Advance generation on seek, new media,
// or format change; leave index=-1 when the caller cannot provide that contract.
struct FrameIdentity { uint64_t generation = 0; int64_t index = -1; };

struct FrameView {
    const float* planes[3];
    size_t strides[3]; // bytes per row; planar RGB float32, normalized to 0..1
    int width, height;
    FrameIdentity identity{};
};

struct FrameBuffer {
    int width = 0, height = 0;
    std::vector<float> pixels; // contiguous planar RGB; never quantized to uint8
    double inferenceMs = 0;
    unsigned encoderPredictions = 0;
    bool featureCacheHit = false;
    unsigned directWarpBuffers = 0; // actual shared output backings honored, 0..3
};

struct EngineConfig {
    std::string modelDirectory;
    ComputePolicy computePolicy = ComputePolicy::CPUAndGPU;
    int width = 0, height = 0;
    Pipeline pipeline = Pipeline::Monolithic;
};
} // namespace rife

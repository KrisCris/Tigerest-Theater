#pragma once
#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>

namespace rife {
enum class ComputePolicy { All, CPUAndGPU, CPUAndNeuralEngine };
enum class ErrorCode { InvalidConfiguration, InvalidFrame, Busy, ModelLoad, Inference, NonFinite };

class EngineError : public std::runtime_error {
public:
    EngineError(ErrorCode code, const std::string& message) : std::runtime_error(message), m_code(code) {}
    ErrorCode code() const noexcept { return m_code; }
private:
    ErrorCode m_code;
};

struct FrameView {
    const float* planes[3];
    size_t strides[3]; // bytes per row; planar RGB float32, normalized to 0..1
    int width, height;
};

struct FrameBuffer {
    int width = 0, height = 0;
    std::vector<float> pixels; // contiguous planar RGB; never quantized to uint8
    double inferenceMs = 0;
};

struct EngineConfig {
    std::string modelDirectory;
    ComputePolicy computePolicy = ComputePolicy::CPUAndGPU;
    int width = 0, height = 0;
};
} // namespace rife

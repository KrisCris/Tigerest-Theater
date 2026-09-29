#include "RifeEngine.h"
#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>

namespace rife {
using Clock = std::chrono::steady_clock;

static void error(ErrorCode code, NSString* description) {
    throw EngineError(code, description ? description.UTF8String : "Core ML error");
}

struct RifeEngine::Impl {
    EngineConfig config;
    MLModel* model = nil;
    MLMultiArray* inputs[2] = {nil, nil};
    MLDictionaryFeatureProvider* provider = nil;
    NSURL* temporaryModel = nil;
    std::atomic_flag busy = ATOMIC_FLAG_INIT;

    ~Impl() {
        @autoreleasepool {
            provider = nil;
            inputs[0] = nil; inputs[1] = nil;
            model = nil;
            if (temporaryModel) [[NSFileManager defaultManager] removeItemAtURL:temporaryModel error:nil];
        }
    }

    void copyInput(const FrameView& frame, int index) {
        if (frame.width != config.width || frame.height != config.height)
            throw EngineError(ErrorCode::InvalidFrame, "RIFE frame dimensions changed");
        const size_t rowBytes = size_t(frame.width) * sizeof(float);
        float* dst = static_cast<float*>(inputs[index].dataPointer);
        for (int c = 0; c < 3; ++c) {
            if (!frame.planes[c] || frame.strides[c] < rowBytes || frame.strides[c] % alignof(float))
                throw EngineError(ErrorCode::InvalidFrame, "Invalid RIFE frame plane/stride");
            for (int y = 0; y < frame.height; ++y) {
                const float* row = reinterpret_cast<const float*>(
                    reinterpret_cast<const char*>(frame.planes[c]) + size_t(y) * frame.strides[c]);
                bool finite = true;
                for (int x = 0; x < frame.width; ++x) finite &= std::isfinite(row[x]);
                if (!finite) throw EngineError(ErrorCode::NonFinite, "Non-finite RIFE input");
                memcpy(dst + (size_t(c) * frame.height + y) * frame.width, row, rowBytes);
            }
        }
    }
};

RifeEngine::RifeEngine(std::unique_ptr<Impl> impl) : m_impl(std::move(impl)) {}
RifeEngine::~RifeEngine() = default;

std::unique_ptr<RifeEngine> RifeEngine::create(const EngineConfig& config) {
    @autoreleasepool {
        if (config.width < 2 || config.height < 2 || config.width > 4096 || config.height > 2160)
            throw EngineError(ErrorCode::InvalidConfiguration, "Unsupported RIFE dimensions");
        auto state = std::make_unique<Impl>();
        state->config = config;
        NSString* directory = [NSString stringWithUTF8String:config.modelDirectory.c_str()];
        if (!directory) throw EngineError(ErrorCode::InvalidConfiguration, "Invalid model path encoding");
        NSURL* source = [NSURL fileURLWithPath:[directory stringByAppendingPathComponent:@"RIFE.mlmodelc"]];
        NSError* err = nil;
        if (![[NSFileManager defaultManager] fileExistsAtPath:source.path]) {
            source = [NSURL fileURLWithPath:[directory stringByAppendingPathComponent:@"RIFE.mlpackage"]];
            if (![[NSFileManager defaultManager] fileExistsAtPath:source.path])
                throw EngineError(ErrorCode::ModelLoad, "Bundled RIFE model is missing");
            source = [MLModel compileModelAtURL:source error:&err];
            if (!source) error(ErrorCode::ModelLoad, err.localizedDescription);
            state->temporaryModel = source;
        }
        MLModelConfiguration* settings = [MLModelConfiguration new];
        switch (config.computePolicy) {
            case ComputePolicy::All: settings.computeUnits = MLComputeUnitsAll; break;
            case ComputePolicy::CPUAndGPU: settings.computeUnits = MLComputeUnitsCPUAndGPU; break;
            case ComputePolicy::CPUAndNeuralEngine: settings.computeUnits = MLComputeUnitsCPUAndNeuralEngine; break;
            default: throw EngineError(ErrorCode::InvalidConfiguration, "Unknown compute policy");
        }
        state->model = [MLModel modelWithContentsOfURL:source configuration:settings error:&err];
        if (!state->model) error(ErrorCode::ModelLoad, err.localizedDescription);
        NSArray<NSNumber*>* expected = @[@1, @3, @(config.height), @(config.width)];
        for (int i = 0; i < 2; ++i) {
            NSString* name = i ? @"frame1" : @"frame0";
            MLMultiArrayConstraint* constraint = state->model.modelDescription.inputDescriptionsByName[name].multiArrayConstraint;
            if (![constraint.shape isEqualToArray:expected] || constraint.dataType != MLMultiArrayDataTypeFloat32)
                throw EngineError(ErrorCode::InvalidConfiguration, "RIFE model does not match requested frame layout");
            state->inputs[i] = [[MLMultiArray alloc] initWithShape:expected dataType:MLMultiArrayDataTypeFloat32 error:&err];
            if (!state->inputs[i]) error(ErrorCode::ModelLoad, err.localizedDescription);
            size_t stride = 1;
            for (int d = 3; d >= 0; --d) {
                if (state->inputs[i].strides[d].unsignedLongLongValue != stride)
                    throw EngineError(ErrorCode::ModelLoad, "Unexpected Core ML input strides");
                stride *= expected[d].unsignedLongLongValue;
            }
        }
        state->provider = [[MLDictionaryFeatureProvider alloc] initWithDictionary:@{
            @"frame0": [MLFeatureValue featureValueWithMultiArray:state->inputs[0]],
            @"frame1": [MLFeatureValue featureValueWithMultiArray:state->inputs[1]]} error:&err];
        if (!state->provider) error(ErrorCode::ModelLoad, err.localizedDescription);
        return std::unique_ptr<RifeEngine>(new RifeEngine(std::move(state)));
    }
}

FrameBuffer RifeEngine::interpolate(const FrameView& a, const FrameView& b, float timestep) {
    if (m_impl->busy.test_and_set(std::memory_order_acquire))
        throw EngineError(ErrorCode::Busy, "RIFE engine is already processing a frame");
    struct Guard { std::atomic_flag& flag; ~Guard() { flag.clear(std::memory_order_release); } } guard{m_impl->busy};
    @autoreleasepool {
        const auto start = Clock::now();
        if (timestep != .5f) throw EngineError(ErrorCode::InvalidFrame, "This RIFE model only supports 2x interpolation");
        m_impl->copyInput(a, 0);
        m_impl->copyInput(b, 1);
        NSError* err = nil;
        id<MLFeatureProvider> prediction = [m_impl->model predictionFromFeatures:m_impl->provider error:&err];
        if (!prediction) error(ErrorCode::Inference, err.localizedDescription);
        MLMultiArray* result = [prediction featureValueForName:@"interpolated"].multiArrayValue;
        NSArray* expected = @[@1, @3, @(m_impl->config.height), @(m_impl->config.width)];
        if (!result || result.dataType != MLMultiArrayDataTypeFloat32 || ![result.shape isEqualToArray:expected])
            throw EngineError(ErrorCode::Inference, "Unexpected RIFE output layout");
        FrameBuffer output;
        output.width = m_impl->config.width; output.height = m_impl->config.height;
        output.pixels.resize(size_t(output.width) * output.height * 3);
        const float* data = static_cast<const float*>(result.dataPointer);
        const size_t sc = result.strides[1].unsignedLongLongValue;
        const size_t sy = result.strides[2].unsignedLongLongValue;
        const size_t sx = result.strides[3].unsignedLongLongValue;
        bool finite = true;
        for (int c = 0; c < 3; ++c) for (int y = 0; y < output.height; ++y) {
            const float* row = data + c * sc + y * sy;
            float* destination = output.pixels.data() + (size_t(c) * output.height + y) * output.width;
            if (sx == 1) memcpy(destination, row, size_t(output.width) * sizeof(float));
            else for (int x = 0; x < output.width; ++x) destination[x] = row[x * sx];
            for (int x = 0; x < output.width; ++x) finite &= std::isfinite(destination[x]);
        }
        if (!finite) throw EngineError(ErrorCode::NonFinite, "Non-finite RIFE output");
        output.inferenceMs = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
        return output;
    }
}
} // namespace rife

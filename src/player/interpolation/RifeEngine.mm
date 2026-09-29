#include "RifeEngine.h"
#include "RifeMetalWarp.h"
#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

namespace rife {
using Clock = std::chrono::steady_clock;

static void error(ErrorCode code, NSString* description) {
    throw EngineError(code, description ? description.UTF8String : "Core ML error");
}

static MLComputeUnits computeUnits(ComputePolicy policy) {
    switch (policy) {
        case ComputePolicy::All: return MLComputeUnitsAll;
        case ComputePolicy::CPUAndGPU: return MLComputeUnitsCPUAndGPU;
        case ComputePolicy::CPUAndNeuralEngine: return MLComputeUnitsCPUAndNeuralEngine;
    }
    throw EngineError(ErrorCode::InvalidConfiguration, "Unknown compute policy");
}

static NSArray* shape(int channels, int width, int height) { return @[@1,@(channels),@(height),@(width)]; }

static void checkTensor(MLModel* model, NSString* name, NSArray* expected, MLMultiArrayDataType type, bool output=false) {
    NSDictionary* descriptions=output ? model.modelDescription.outputDescriptionsByName : model.modelDescription.inputDescriptionsByName;
    MLMultiArrayConstraint* constraint=[descriptions[name] multiArrayConstraint];
    if (![constraint.shape isEqualToArray:expected] || constraint.dataType != type)
        throw EngineError(ErrorCode::InvalidConfiguration,"RIFE model does not match requested tensor layout");
}

static MLMultiArray* allocate(NSArray* dimensions) {
    NSError* err=nil;
    MLMultiArray* result=[[MLMultiArray alloc] initWithShape:dimensions dataType:MLMultiArrayDataTypeFloat32 error:&err];
    if (!result) error(ErrorCode::ModelLoad,err.localizedDescription);
    size_t stride=1;
    for (int d=3;d>=0;--d) {
        if (result.strides[d].unsignedLongLongValue!=stride)
            throw EngineError(ErrorCode::ModelLoad,"Unexpected Core ML input strides");
        stride*=[dimensions[d] unsignedLongLongValue];
    }
    return result;
}

static id<MLFeatureProvider> predict(MLModel* model, NSDictionary* inputs, MLPredictionOptions* options=nil) {
    NSError* err=nil;
    MLDictionaryFeatureProvider* provider=[[MLDictionaryFeatureProvider alloc] initWithDictionary:inputs error:&err];
    if (!provider) error(ErrorCode::Inference,err.localizedDescription);
    id<MLFeatureProvider> result=options ? [model predictionFromFeatures:provider options:options error:&err]
                                       : [model predictionFromFeatures:provider error:&err];
    if (!result) error(ErrorCode::Inference,err.localizedDescription);
    return result;
}

static MLMultiArray* tensor(id<MLFeatureProvider> prediction, NSString* name) {
    MLMultiArray* result=[prediction featureValueForName:name].multiArrayValue;
    if (!result) throw EngineError(ErrorCode::Inference,"Missing RIFE tensor output");
    return result;
}

struct RifeEngine::Impl {
    EngineConfig config;
    MLModel* model = nil;
    MLModel* encoder = nil;
    MLModel* coarse = nil;
    MLModel* refine = nil;
    MLModel* warp = nil;
    std::unique_ptr<MetalWarp> metalWarp;
    MLMultiArray* inputs[2] = {nil, nil};
    MLMultiArray* low[2] = {nil,nil};
    MLMultiArray* cachedFeatures = nil;
    FrameIdentity cachedIdentity;
    int cachedSlot = 1;
    int lowWidth = 0, lowHeight = 0;
    MLDictionaryFeatureProvider* provider = nil;
    NSMutableArray<NSURL*>* temporaryModels = [NSMutableArray array];
    std::atomic_flag busy = ATOMIC_FLAG_INIT;

    ~Impl() {
        @autoreleasepool {
            provider = nil;
            inputs[0] = nil; inputs[1] = nil;
            low[0]=nil;low[1]=nil;cachedFeatures=nil;
            model=nil;encoder=nil;coarse=nil;refine=nil;warp=nil;
            for (NSURL* url in temporaryModels) [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
        }
    }

    MLModel* load(NSString* directory, NSString* name, MLComputeUnits units) {
        NSURL* source=[NSURL fileURLWithPath:[directory stringByAppendingPathComponent:[name stringByAppendingString:@".mlmodelc"]]];
        NSError* err=nil;
        if (![[NSFileManager defaultManager] fileExistsAtPath:source.path]) {
            source=[NSURL fileURLWithPath:[directory stringByAppendingPathComponent:[name stringByAppendingString:@".mlpackage"]]];
            if (![[NSFileManager defaultManager] fileExistsAtPath:source.path])
                throw EngineError(ErrorCode::ModelLoad,"Bundled RIFE model is missing");
            source=[MLModel compileModelAtURL:source error:&err];
            if (!source) error(ErrorCode::ModelLoad,err.localizedDescription);
            [temporaryModels addObject:source];
        }
        MLModelConfiguration* settings=[MLModelConfiguration new];settings.computeUnits=units;
        MLModel* result=[MLModel modelWithContentsOfURL:source configuration:settings error:&err];
        if (!result) error(ErrorCode::ModelLoad,err.localizedDescription);
        return result;
    }

    void clearCache() { cachedFeatures=nil;cachedIdentity={}; }

    void validateView(const FrameView& frame) const {
        if (frame.width != config.width || frame.height != config.height)
            throw EngineError(ErrorCode::InvalidFrame, "RIFE frame dimensions changed");
        const size_t rowBytes = size_t(frame.width) * sizeof(float);
        for (int c = 0; c < 3; ++c) {
            if (!frame.planes[c] || frame.strides[c] < rowBytes || frame.strides[c] % alignof(float))
                throw EngineError(ErrorCode::InvalidFrame, "Invalid RIFE frame plane/stride");
        }
    }

    void copyInput(const FrameView& frame, int index) {
        validateView(frame);
        const size_t rowBytes=size_t(frame.width)*sizeof(float);
        float* dst = static_cast<float*>(inputs[index].dataPointer);
        for (int c = 0; c < 3; ++c) {
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

    void prepareLow(int index) {
        const int w=config.width,h=config.height,lw=lowWidth,lh=lowHeight;
        const float* full=static_cast<const float*>(inputs[index].dataPointer);
        float* reduced=static_cast<float*>(low[index].dataPointer);
        // A half-resolution bilinear resize of zero-padded RGB. Keep interior
        // pairs branch-free so the compiler can vectorize the downsample.
        for (int c=0;c<3;++c) {
            float* plane=reduced+size_t(c)*lw*lh;
            const float* source=full+size_t(c)*w*h;
            for (int y=0;y<(h+1)/2;++y) {
                const float* a=source+size_t(y*2)*w;
                const float* b=y*2+1<h ? a+w : nullptr;
                float* row=plane+size_t(y)*lw;
                if (b) for (int x=0;x<w/2;++x) row[x]=(a[2*x]+a[2*x+1]+b[2*x]+b[2*x+1])*.25f;
                else for (int x=0;x<w/2;++x) row[x]=(a[2*x]+a[2*x+1])*.25f;
                if (w%2) row[w/2]=(a[w-1]+(b?b[w-1]:0.f))*.25f;
                std::fill(row+(w+1)/2,row+lw,0.f);
            }
            std::fill(plane+size_t((h+1)/2)*lw,plane+size_t(lh)*lw,0.f);
        }
    }

    MLMultiArray* splitPrediction(const FrameView& a,const FrameView& b,FrameBuffer& output) {
        validateView(a);validateView(b);
        const bool adjacent=a.identity.index>=0 && a.identity.index<INT64_MAX &&
            b.identity.index==a.identity.index+1 && a.identity.generation==b.identity.generation;
        const bool hit=adjacent && cachedFeatures && cachedIdentity.index==a.identity.index &&
            cachedIdentity.generation==a.identity.generation;
        const int first=hit?cachedSlot:0,second=1-first;
        MLMultiArray* features0=hit?cachedFeatures:nil;
        clearCache(); // A failed prediction must never retain partially updated state.
        if (!hit) {copyInput(a,first);prepareLow(first);features0=tensor(predict(encoder,@{@"rgb":low[first]}),@"features");}
        copyInput(b,second);prepareLow(second);
        MLMultiArray* features1=tensor(predict(encoder,@{@"rgb":low[second]}),@"features");
        id<MLFeatureProvider> motion=predict(coarse,@{@"low0":low[first],@"low1":low[second],
                                                    @"features0":features0,@"features1":features1},metalWarp?metalWarp->coarseOptions():nil);
        id<MLFeatureProvider> fine=predict(refine,@{@"refine_input":tensor(motion,@"refine_input")},metalWarp?metalWarp->refineOptions():nil);
        MLMultiArray* result=metalWarp ? metalWarp->predict(tensor(motion,@"coarse_flow"),tensor(fine,@"delta"),tensor(fine,@"mask"),first,second)
            : tensor(predict(warp,@{@"frame0":inputs[first],@"frame1":inputs[second],
                @"coarse_flow":tensor(motion,@"coarse_flow"),@"delta":tensor(fine,@"delta"),@"mask":tensor(fine,@"mask")}),@"interpolated");
        if (adjacent) {cachedFeatures=features1;cachedIdentity=b.identity;cachedSlot=second;}
        output.featureCacheHit=hit;output.encoderPredictions=hit?1:2;
        output.directWarpBuffers=metalWarp?metalWarp->directBufferCount():0;
        return result;
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
        NSError* err = nil;
        const MLComputeUnits units=computeUnits(config.computePolicy);
        NSArray* expected=shape(3,config.width,config.height);
        const bool metal=config.pipeline==Pipeline::SplitEncoderRefineMetal;
        if (!metal) for (int i=0;i<2;++i) state->inputs[i]=allocate(expected);
        if (config.pipeline==Pipeline::Monolithic) {
            state->model=state->load(directory,@"RIFE",units);
            checkTensor(state->model,@"frame0",expected,MLMultiArrayDataTypeFloat32);
            checkTensor(state->model,@"frame1",expected,MLMultiArrayDataTypeFloat32);
            checkTensor(state->model,@"interpolated",expected,MLMultiArrayDataTypeFloat32,true);
            state->provider = [[MLDictionaryFeatureProvider alloc] initWithDictionary:@{
                @"frame0": [MLFeatureValue featureValueWithMultiArray:state->inputs[0]],
                @"frame1": [MLFeatureValue featureValueWithMultiArray:state->inputs[1]]} error:&err];
            if (!state->provider) error(ErrorCode::ModelLoad, err.localizedDescription);
        } else if (config.pipeline==Pipeline::SplitEncoderRefine || metal) {
            NSData* bytes=[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"manifest.json"]];
            id metadata=bytes ? [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil] : nil;
            if (![metadata isKindOfClass:[NSDictionary class]])
                throw EngineError(ErrorCode::InvalidConfiguration,"Missing split RIFE manifest");
            NSDictionary* manifest=metadata;
            if (![manifest[@"pipeline"] isEqual:@"ane-encoder-refine-gpu-motion"] ||
                ![manifest[@"grid_scale"] isEqual:@0.5] || ![manifest[@"width"] isEqual:@(config.width)] ||
                ![manifest[@"height"] isEqual:@(config.height)])
                throw EngineError(ErrorCode::InvalidConfiguration,"Unsupported split RIFE model");
            const int lw=((config.width+255)/256)*128,lh=((config.height+255)/256)*128;
            if (![manifest[@"low_width"] isEqual:@(lw)] || ![manifest[@"low_height"] isEqual:@(lh)])
                throw EngineError(ErrorCode::InvalidConfiguration,"Invalid split RIFE motion grid");
            state->lowWidth=lw;state->lowHeight=lh;
            state->encoder=state->load(directory,@"Encoder",units);
            state->coarse=state->load(directory,@"Coarse",MLComputeUnitsCPUAndGPU);
            state->refine=state->load(directory,@"Refine",units);
            if (!metal) state->warp=state->load(directory,@"Warp",MLComputeUnitsCPUAndGPU);
            const auto f32=MLMultiArrayDataTypeFloat32,f16=MLMultiArrayDataTypeFloat16;
            NSArray* rgb=shape(3,lw,lh),*features=shape(4,lw,lh),*packed=shape(28,lw,lh),*mask=shape(1,lw,lh);
            checkTensor(state->encoder,@"rgb",rgb,f32);
            checkTensor(state->encoder,@"features",features,f32,true);
            for (NSString* name in @[@"low0",@"low1"]) checkTensor(state->coarse,name,rgb,f32);
            for (NSString* name in @[@"features0",@"features1"]) checkTensor(state->coarse,name,features,f32);
            checkTensor(state->coarse,@"refine_input",packed,f16,true);
            checkTensor(state->coarse,@"coarse_flow",features,f32,true);
            checkTensor(state->refine,@"refine_input",packed,f16);
            checkTensor(state->refine,@"delta",features,f16,true);
            checkTensor(state->refine,@"mask",mask,f16,true);
            if (metal) {
                state->metalWarp=MetalWarp::create(config.width,config.height,lw,lh);
                for (int i=0;i<2;++i) state->inputs[i]=state->metalWarp->input(i);
            } else {
                for (NSString* name in @[@"frame0",@"frame1"]) checkTensor(state->warp,name,expected,f32);
                checkTensor(state->warp,@"coarse_flow",features,f32);
                checkTensor(state->warp,@"delta",features,f16);
                checkTensor(state->warp,@"mask",mask,f16);
                checkTensor(state->warp,@"interpolated",expected,f32,true);
            }
            state->low[0]=allocate(rgb);state->low[1]=allocate(rgb);
        } else throw EngineError(ErrorCode::InvalidConfiguration,"Unknown RIFE pipeline");
        return std::unique_ptr<RifeEngine>(new RifeEngine(std::move(state)));
    }
}

FrameBuffer RifeEngine::interpolate(const FrameView& a, const FrameView& b, float timestep) {
    if (m_impl->busy.test_and_set(std::memory_order_acquire))
        throw EngineError(ErrorCode::Busy, "RIFE engine is already processing a frame");
    struct Guard { std::atomic_flag& flag; ~Guard() { flag.clear(std::memory_order_release); } } guard{m_impl->busy};
    try { @autoreleasepool {
        const auto start = Clock::now();
        if (timestep != .5f) throw EngineError(ErrorCode::InvalidFrame, "This RIFE model only supports 2x interpolation");
        FrameBuffer output;
        MLMultiArray* result=nil;
        if (m_impl->config.pipeline!=Pipeline::Monolithic) result=m_impl->splitPrediction(a,b,output);
        else {
            m_impl->copyInput(a, 0);m_impl->copyInput(b, 1);
            NSError* err=nil;
            id<MLFeatureProvider> prediction=[m_impl->model predictionFromFeatures:m_impl->provider error:&err];
            if (!prediction) error(ErrorCode::Inference,err.localizedDescription);
            result=tensor(prediction,@"interpolated");
        }
        NSArray* expected = @[@1, @3, @(m_impl->config.height), @(m_impl->config.width)];
        if (!result || result.dataType != MLMultiArrayDataTypeFloat32 || ![result.shape isEqualToArray:expected])
            throw EngineError(ErrorCode::Inference, "Unexpected RIFE output layout");
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
    }} catch (...) {
        m_impl->clearCache();
        throw;
    }
}

void RifeEngine::reset() {
    if (m_impl->busy.test_and_set(std::memory_order_acquire))
        throw EngineError(ErrorCode::Busy,"RIFE engine is already processing a frame");
    m_impl->clearCache();
    m_impl->busy.clear(std::memory_order_release);
}
} // namespace rife

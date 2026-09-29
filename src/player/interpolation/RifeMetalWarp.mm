#include "RifeMetalWarp.h"
#include "RifeTypes.h"
#import <Metal/Metal.h>
#include <algorithm>
#include <cstring>

namespace rife {
namespace {
// Equivalent to half-grid bilinear flow/mask upsampling, border-mode image
// warping on zero-padded RGB, and sigmoid blending. No intermediate full-size
// grids or warped images are materialized. Coordinates remain FP32.
constexpr const char* source=R"metal(
#include <metal_stdlib>
using namespace metal;
struct Size { uint width,height,lowWidth,lowHeight; };
float readFlow(device const float* coarse,device const half* delta,uint channel,uint x,uint y,constant Size& s) {
    uint i=(channel*s.lowHeight+y)*s.lowWidth+x;
    return coarse[i]+float(delta[i]);
}
float sampleFlow(device const float* coarse,device const half* delta,uint c,uint2 lo,uint2 hi,float2 f,constant Size& s) {
    float a=mix(readFlow(coarse,delta,c,lo.x,lo.y,s),readFlow(coarse,delta,c,hi.x,lo.y,s),f.x);
    float b=mix(readFlow(coarse,delta,c,lo.x,hi.y,s),readFlow(coarse,delta,c,hi.x,hi.y,s),f.x);
    return mix(a,b,f.y)*2.0f;
}
float3 rgb(device const float* frame,uint x,uint y,constant Size& s) {
    if(x>=s.width || y>=s.height)return float3(0.0f);
    uint i=y*s.width+x,p=s.width*s.height;
    return float3(frame[i],frame[p+i],frame[2*p+i]);
}
float3 sampleRGB(device const float* frame,float2 position,constant Size& s) {
    // Padding happens before the reference warp; its border is the padded
    // image border, not the last visible pixel of the original image.
    float2 maximum=float2(s.lowWidth*2-1,s.lowHeight*2-1);
    position=clamp(position,float2(0.0f),maximum);
    uint2 lo=uint2(floor(position)),hi=min(lo+1,uint2(maximum));
    float2 f=position-float2(lo);
    return mix(mix(rgb(frame,lo.x,lo.y,s),rgb(frame,hi.x,lo.y,s),f.x),
               mix(rgb(frame,lo.x,hi.y,s),rgb(frame,hi.x,hi.y,s),f.x),f.y);
}
kernel void rifeWarp(device const float* a [[buffer(0)]],device const float* b [[buffer(1)]],
                     device const float* coarse [[buffer(2)]],device const half* delta [[buffer(3)]],
                     device const half* mask [[buffer(4)]],device float* output [[buffer(5)]],
                     constant Size& s [[buffer(6)]],uint2 xy [[thread_position_in_grid]]) {
    if(xy.x>=s.width || xy.y>=s.height)return;
    float2 position=clamp((float2(xy)+0.5f)*0.5f-0.5f,float2(0.0f),float2(s.lowWidth-1,s.lowHeight-1));
    uint2 lo=uint2(floor(position)),hi=min(lo+1,uint2(s.lowWidth-1,s.lowHeight-1));
    float2 f=position-float2(lo);
    float2 flow0=float2(sampleFlow(coarse,delta,0,lo,hi,f,s),sampleFlow(coarse,delta,1,lo,hi,f,s));
    float2 flow1=float2(sampleFlow(coarse,delta,2,lo,hi,f,s),sampleFlow(coarse,delta,3,lo,hi,f,s));
    float logit=mix(mix(float(mask[lo.y*s.lowWidth+lo.x]),float(mask[lo.y*s.lowWidth+hi.x]),f.x),
                    mix(float(mask[hi.y*s.lowWidth+lo.x]),float(mask[hi.y*s.lowWidth+hi.x]),f.x),f.y);
    float weight=1.0f/(1.0f+exp(-logit));
    // Retain the reference's normalized coordinate round-trip (align_corners).
    float2 maximum=float2(s.lowWidth*2-1,s.lowHeight*2-1);
    float2 grid=2.0f*float2(xy)/maximum-1.0f;
    float2 p0=((grid+flow0/(maximum*0.5f))+1.0f)*0.5f*maximum;
    float2 p1=((grid+flow1/(maximum*0.5f))+1.0f)*0.5f*maximum;
    float3 value=sampleRGB(a,p0,s)*weight+sampleRGB(b,p1,s)*(1.0f-weight);
    uint i=xy.y*s.width+xy.x,p=s.width*s.height;
    output[i]=value.x;output[p+i]=value.y;output[2*p+i]=value.z;
}
)metal";

void fail(ErrorCode code,NSString* text) {throw EngineError(code,text?text.UTF8String:"Metal RIFE failure");}
MLMultiArray* wrap(id<MTLBuffer> storage,int width,int height,int channels=3,MLMultiArrayDataType type=MLMultiArrayDataTypeFloat32) {
    NSError* error=nil;
    MLMultiArray* result=[[MLMultiArray alloc] initWithDataPointer:storage.contents
        shape:@[@1,@(channels),@(height),@(width)] dataType:type
        strides:@[@(size_t(width)*height*channels),@(size_t(width)*height),@(width),@1]
        deallocator:^(void*) { (void)storage; } error:&error];
    if(!result)fail(ErrorCode::ModelLoad,error.localizedDescription);
    return result;
}
bool upload(MLMultiArray* array,MLMultiArray* backing,id<MTLBuffer> buffer,int channels,int width,int height,MLMultiArrayDataType type) {
    if(array.dataType!=type || ![array.shape isEqual:@[@1,@(channels),@(height),@(width)]])
        throw EngineError(ErrorCode::Inference,"Invalid Metal warp input layout");
    if(array==backing) {
        // Materialize the Core ML output before another command queue reads it.
        (void)*static_cast<const volatile unsigned char*>(array.dataPointer);
        return true;
    }
    const size_t bytes=type==MLMultiArrayDataTypeFloat32?4:2;
    const size_t sc=[array.strides[1] unsignedLongLongValue],sy=[array.strides[2] unsignedLongLongValue],sx=[array.strides[3] unsignedLongLongValue];
    const char* src=static_cast<const char*>(array.dataPointer);
    char* dst=static_cast<char*>(buffer.contents);
    for(int c=0;c<channels;++c)for(int y=0;y<height;++y) {
        const char* row=src+(c*sc+y*sy)*bytes;
        char* target=dst+(size_t(c)*height+y)*width*bytes;
        if(sx==1)memcpy(target,row,size_t(width)*bytes);
        else for(int x=0;x<width;++x)memcpy(target+x*bytes,row+x*sx*bytes,bytes);
    }
    return false;
}
}

struct MetalWarp::Impl {
    struct Size {uint32_t width,height,lowWidth,lowHeight;} size{};
    id<MTLDevice> device;
    id<MTLCommandQueue> queue;
    id<MTLComputePipelineState> pipeline;
    id<MTLBuffer> frames[2],coarse,delta,mask,output;
    MLMultiArray* inputs[2];
    MLMultiArray* result;
    MLMultiArray* coarseBacking;
    MLMultiArray* deltaBacking;
    MLMultiArray* maskBacking;
    MLPredictionOptions* coarseOptions=[MLPredictionOptions new];
    MLPredictionOptions* refineOptions=[MLPredictionOptions new];
    unsigned directBuffers=0;
    id<MTLBuffer> allocate(size_t bytes) {
        id<MTLBuffer> buffer=[device newBufferWithLength:bytes options:MTLResourceStorageModeShared];
        if(!buffer)throw EngineError(ErrorCode::ModelLoad,"Cannot allocate shared Metal frame buffer");
        return buffer;
    }
};
MetalWarp::MetalWarp(std::unique_ptr<Impl> impl):m_impl(std::move(impl)){}
MetalWarp::~MetalWarp()=default;
std::unique_ptr<MetalWarp> MetalWarp::create(int width,int height,int lowWidth,int lowHeight) {
    auto state=std::make_unique<Impl>();
    state->size={uint32_t(width),uint32_t(height),uint32_t(lowWidth),uint32_t(lowHeight)};
    state->device=MTLCreateSystemDefaultDevice();
    if(!state->device)throw EngineError(ErrorCode::ModelLoad,"Metal device is unavailable");
    state->queue=[state->device newCommandQueue];
    NSError* error=nil;
    MTLCompileOptions* options=[MTLCompileOptions new];options.mathMode=MTLMathModeSafe;
    id<MTLLibrary> library=[state->device newLibraryWithSource:@(source) options:options error:&error];
    if(!library)fail(ErrorCode::ModelLoad,error.localizedDescription);
    id<MTLFunction> function=[library newFunctionWithName:@"rifeWarp"];
    state->pipeline=[state->device newComputePipelineStateWithFunction:function error:&error];
    if(!state->pipeline || !state->queue)fail(ErrorCode::ModelLoad,error.localizedDescription);
    const size_t full=size_t(width)*height*3*sizeof(float),low=size_t(lowWidth)*lowHeight;
    for(int i=0;i<2;++i) {state->frames[i]=state->allocate(full);state->inputs[i]=wrap(state->frames[i],width,height);}
    state->coarse=state->allocate(low*4*sizeof(float));state->delta=state->allocate(low*4*2);state->mask=state->allocate(low*2);
    state->coarseBacking=wrap(state->coarse,lowWidth,lowHeight,4);
    state->deltaBacking=wrap(state->delta,lowWidth,lowHeight,4,MLMultiArrayDataTypeFloat16);
    state->maskBacking=wrap(state->mask,lowWidth,lowHeight,1,MLMultiArrayDataTypeFloat16);
    state->coarseOptions.outputBackings=@{@"coarse_flow":state->coarseBacking};
    state->refineOptions.outputBackings=@{@"delta":state->deltaBacking,@"mask":state->maskBacking};
    state->output=state->allocate(full);state->result=wrap(state->output,width,height);
    return std::unique_ptr<MetalWarp>(new MetalWarp(std::move(state)));
}
MLMultiArray* MetalWarp::input(int slot) const {return m_impl->inputs[slot];}
MLPredictionOptions* MetalWarp::coarseOptions() const {return m_impl->coarseOptions;}
MLPredictionOptions* MetalWarp::refineOptions() const {return m_impl->refineOptions;}
unsigned MetalWarp::directBufferCount() const {return m_impl->directBuffers;}
MLMultiArray* MetalWarp::predict(MLMultiArray* coarse,MLMultiArray* delta,MLMultiArray* mask,int first,int second) {
    auto& s=*m_impl;
    s.directBuffers=upload(coarse,s.coarseBacking,s.coarse,4,s.size.lowWidth,s.size.lowHeight,MLMultiArrayDataTypeFloat32);
    s.directBuffers+=upload(delta,s.deltaBacking,s.delta,4,s.size.lowWidth,s.size.lowHeight,MLMultiArrayDataTypeFloat16);
    s.directBuffers+=upload(mask,s.maskBacking,s.mask,1,s.size.lowWidth,s.size.lowHeight,MLMultiArrayDataTypeFloat16);
    id<MTLCommandBuffer> command=[s.queue commandBuffer];
    id<MTLComputeCommandEncoder> compute=[command computeCommandEncoder];
    if(!command || !compute)throw EngineError(ErrorCode::Inference,"Cannot create Metal command");
    [compute setComputePipelineState:s.pipeline];
    [compute setBuffer:s.frames[first] offset:0 atIndex:0];[compute setBuffer:s.frames[second] offset:0 atIndex:1];
    [compute setBuffer:s.coarse offset:0 atIndex:2];[compute setBuffer:s.delta offset:0 atIndex:3];
    [compute setBuffer:s.mask offset:0 atIndex:4];[compute setBuffer:s.output offset:0 atIndex:5];
    [compute setBytes:&s.size length:sizeof(s.size) atIndex:6];
    const NSUInteger width=s.pipeline.threadExecutionWidth;
    const NSUInteger height=std::min<NSUInteger>(8,s.pipeline.maxTotalThreadsPerThreadgroup/width);
    [compute dispatchThreads:MTLSizeMake(s.size.width,s.size.height,1) threadsPerThreadgroup:MTLSizeMake(width,height,1)];
    [compute endEncoding];[command commit];[command waitUntilCompleted];
    if(command.status!=MTLCommandBufferStatusCompleted)fail(ErrorCode::Inference,command.error.localizedDescription);
    return s.result;
}
}

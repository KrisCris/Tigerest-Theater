#include "RifeCoarseMetal.h"
#include "RifeTypes.h"
#import <Metal/Metal.h>
#include <algorithm>
#include <cstring>

namespace rife {
namespace {
constexpr const char* source=R"metal(
#include <metal_stdlib>
using namespace metal;
struct Size {uint width,height,scale,stage;};
float pixel(device const float* p,uint c,uint2 q,uint w,uint h) {return p[(c*h+q.y)*w+q.x];}
float sample(device const float* p,uint c,float2 q,uint w,uint h) {
    q=clamp(q,float2(0),float2(w-1,h-1));
    uint2 lo=uint2(floor(q)),hi=min(lo+1,uint2(w-1,h-1));float2 f=q-float2(lo);
    return mix(mix(pixel(p,c,lo,w,h),pixel(p,c,uint2(hi.x,lo.y),w,h),f.x),
               mix(pixel(p,c,uint2(lo.x,hi.y),w,h),pixel(p,c,hi,w,h),f.x),f.y);
}
float warped(device const float* p,device const float* state,uint c,uint side,uint2 q,constant Size& s) {
    float2 maximum=float2(s.width-1,s.height-1);
    float2 flow=float2(pixel(state,side*2,q,s.width,s.height),pixel(state,side*2+1,q,s.width,s.height));
    float2 grid=2.0f*float2(q)/maximum-1.0f;
    float2 position=((grid+flow/(maximum*.5f))+1.0f)*.5f*maximum;
    return sample(p,c,position,s.width,s.height);
}
float packedValue(device const float* a,device const float* b,device const float* fa,device const float* fb,
                  device const float* state,uint c,float2 q,constant Size& s) {
    if(c==14)return .5f;
    if(c>=15) {
        uint sc=c==15?4:(c<24?c-11:c-24);
        return sample(state,sc,q,s.width,s.height)/(c>=24?float(s.scale):1.0f);
    }
    device const float* p=c<3?a:(c<6?b:(c<10?fa:fb));
    uint channel=c<3?c:(c<6?c-3:(c<10?c-6:c-10));
    if(s.stage==0)return sample(p,channel,q,s.width,s.height);
    uint side=(c>=3 && c<6)||c>=10?1:0;
    // Reference resizes the already warped image; evaluate its four corners.
    q=clamp(q,float2(0),float2(s.width-1,s.height-1));
    uint2 lo=uint2(floor(q)),hi=min(lo+1,uint2(s.width-1,s.height-1));float2 f=q-float2(lo);
    return mix(mix(warped(p,state,channel,side,lo,s),warped(p,state,channel,side,uint2(hi.x,lo.y),s),f.x),
               mix(warped(p,state,channel,side,uint2(lo.x,hi.y),s),warped(p,state,channel,side,hi,s),f.x),f.y);
}
kernel void packStage(device const float* a [[buffer(0)]],device const float* b [[buffer(1)]],
                      device const float* fa [[buffer(2)]],device const float* fb [[buffer(3)]],
                      device const float* state [[buffer(4)]],device float* output [[buffer(5)]],
                      constant Size& s [[buffer(6)]],uint3 q [[thread_position_in_grid]]) {
    uint w=s.width/s.scale,h=s.height/s.scale;
    if(q.x>=w || q.y>=h || q.z>=(s.stage==0?15:28))return;
    float2 p=(float2(q.xy)+.5f)*float(s.scale)-.5f;
    output[(q.z*h+q.y)*w+q.x]=packedValue(a,b,fa,fb,state,q.z,p,s);
}
kernel void packRefine(device const float* a [[buffer(0)]],device const float* b [[buffer(1)]],
                       device const float* fa [[buffer(2)]],device const float* fb [[buffer(3)]],
                       device const float* state [[buffer(4)]],device half* output [[buffer(5)]],
                       constant Size& s [[buffer(6)]],uint3 q [[thread_position_in_grid]]) {
    if(q.x>=s.width || q.y>=s.height || q.z>=28)return;
    float value;
    if(q.z<14) {
        device const float* p=q.z<3?a:(q.z<6?b:(q.z<10?fa:fb));
        uint c=q.z<3?q.z:(q.z<6?q.z-3:(q.z<10?q.z-6:q.z-10));
        uint side=(q.z>=3 && q.z<6)||q.z>=10?1:0;
        value=warped(p,state,c,side,q.xy,s);
    } else value=packedValue(a,b,fa,fb,state,q.z,float2(q.xy),s);
    output[(q.z*s.height+q.y)*s.width+q.x]=half(value);
}
kernel void updateState(device const float* raw [[buffer(0)]],device const float* old [[buffer(1)]],
                        device float* state [[buffer(2)]],constant Size& s [[buffer(3)]],
                        uint3 q [[thread_position_in_grid]]) {
    if(q.x>=s.width || q.y>=s.height || q.z>=13)return;
    float2 p=(float2(q.xy)+.5f)/float(s.scale)-.5f;
    float value=sample(raw,q.z,p,s.width/s.scale,s.height/s.scale);
    if(q.z<4)value=value*float(s.scale)+(s.stage==0?0.0f:pixel(old,q.z,q.xy,s.width,s.height));
    state[(q.z*s.height+q.y)*s.width+q.x]=value;
}
)metal";
void fail(ErrorCode code,NSString* message) {throw EngineError(code,message?message.UTF8String:"Coarse Metal failure");}
MLMultiArray* wrap(id<MTLBuffer> storage,int w,int h,int c,MLMultiArrayDataType type=MLMultiArrayDataTypeFloat32) {
    NSError* error=nil;
    auto a=[[MLMultiArray alloc] initWithDataPointer:storage.contents shape:@[@1,@(c),@(h),@(w)] dataType:type
        strides:@[@(size_t(w)*h*c),@(size_t(w)*h),@(w),@1] deallocator:^(void*){(void)storage;} error:&error];
    if(!a)fail(ErrorCode::ModelLoad,error.localizedDescription);return a;
}
void upload(MLMultiArray* a,id<MTLBuffer> storage,int w,int h,int c) {
    if(a.dataType!=MLMultiArrayDataTypeFloat32 || ![a.shape isEqual:@[@1,@(c),@(h),@(w)]])
        throw EngineError(ErrorCode::Inference,"Invalid coarse tensor layout");
    const auto* src=static_cast<const float*>(a.dataPointer);
    if(src==storage.contents){(void)*static_cast<const volatile float*>(a.dataPointer);return;}
    auto* dst=static_cast<float*>(storage.contents);
    const size_t sc=[a.strides[1] unsignedLongLongValue],sy=[a.strides[2] unsignedLongLongValue],sx=[a.strides[3] unsignedLongLongValue];
    for(int ch=0;ch<c;++ch)for(int y=0;y<h;++y) {
        const float* row=src+ch*sc+y*sy;float* target=dst+(size_t(ch)*h+y)*w;
        if(sx==1)memcpy(target,row,w*4);else for(int x=0;x<w;++x)target[x]=row[x*sx];
    }
}
}
struct CoarseMetal::Impl {
    struct Size {uint32_t width,height,scale,stage;};
    int width,height,next=0;bool awaiting=false,finished=false;
    id<MTLDevice> device;id<MTLCommandQueue> queue;
    id<MTLComputePipelineState> pack,refine,update;
    id<MTLBuffer> frames[4],states[2],inputs[5],outputs[4];
    MLMultiArray* packed[5];MLMultiArray* raw[4];MLMultiArray* finalFlow;
    MLPredictionOptions* options[4];
    id<MTLBuffer> allocate(size_t bytes) {
        auto result=[device newBufferWithLength:bytes options:MTLResourceStorageModeShared];
        if(!result)throw EngineError(ErrorCode::ModelLoad,"Cannot allocate coarse Metal tensor");return result;
    }
    void dispatch(id<MTLComputeCommandEncoder> enc,id<MTLComputePipelineState> pipeline,int w,int h,int c) {
        [enc setComputePipelineState:pipeline];
        NSUInteger tx=pipeline.threadExecutionWidth,ty=std::min<NSUInteger>(4,pipeline.maxTotalThreadsPerThreadgroup/tx);
        [enc dispatchThreads:MTLSizeMake(w,h,c) threadsPerThreadgroup:MTLSizeMake(tx,ty,1)];
    }
};
CoarseMetal::CoarseMetal(std::unique_ptr<Impl> impl):m_impl(std::move(impl)){}
CoarseMetal::~CoarseMetal()=default;
std::unique_ptr<CoarseMetal> CoarseMetal::create(int w,int h) {
    if(w<128 || h<128 || w%128 || h%128 || w>2048 || h>1152)
        throw EngineError(ErrorCode::InvalidConfiguration,"Invalid coarse motion dimensions");
    auto s=std::make_unique<Impl>();s->width=w;s->height=h;s->device=MTLCreateSystemDefaultDevice();
    s->queue=[s->device newCommandQueue];NSError* error=nil;
    MTLCompileOptions* options=[MTLCompileOptions new];options.mathMode=MTLMathModeSafe;
    auto library=[s->device newLibraryWithSource:@(source) options:options error:&error];
    if(!library || !s->queue)fail(ErrorCode::ModelLoad,error.localizedDescription);
    auto pipeline=[&](NSString* name) {
        auto result=[s->device newComputePipelineStateWithFunction:[library newFunctionWithName:name] error:&error];
        if(!result)fail(ErrorCode::ModelLoad,error.localizedDescription);return result;
    };
    s->pack=pipeline(@"packStage");s->refine=pipeline(@"packRefine");s->update=pipeline(@"updateState");
    const size_t plane=size_t(w)*h;
    for(int i=0;i<4;++i)s->frames[i]=s->allocate(plane*(i<2?3:4)*4);
    for(int i=0;i<2;++i)s->states[i]=s->allocate(plane*13*4);
    for(int i=0;i<4;++i) {
        int scale=32>>i,c=i==0?15:28,sw=w/scale,sh=h/scale;
        s->inputs[i]=s->allocate(size_t(sw)*sh*c*4);s->outputs[i]=s->allocate(size_t(sw)*sh*13*4);
        s->packed[i]=wrap(s->inputs[i],sw,sh,c);s->raw[i]=wrap(s->outputs[i],sw,sh,13);
        s->options[i]=[MLPredictionOptions new];s->options[i].outputBackings=@{@"block_output":s->raw[i]};
    }
    s->inputs[4]=s->allocate(plane*28*2);s->packed[4]=wrap(s->inputs[4],w,h,28,MLMultiArrayDataTypeFloat16);
    s->finalFlow=wrap(s->states[1],w,h,4);
    return std::unique_ptr<CoarseMetal>(new CoarseMetal(std::move(s)));
}
void CoarseMetal::begin(MLMultiArray* a,MLMultiArray* b,MLMultiArray* fa,MLMultiArray* fb) {
    auto& s=*m_impl;s.next=0;s.awaiting=false;s.finished=false;
    MLMultiArray* sources[]={a,b,fa,fb};
    for(int i=0;i<4;++i)upload(sources[i],s.frames[i],s.width,s.height,i<2?3:4);
}
MLMultiArray* CoarseMetal::pack(int stage) {
    auto& s=*m_impl;
    if(stage<0 || stage>4 || stage!=s.next || s.awaiting || s.finished)
        throw EngineError(ErrorCode::Inference,"Out-of-order coarse stage");
    auto command=[s.queue commandBuffer];auto enc=[command computeCommandEncoder];
    if(!enc)throw EngineError(ErrorCode::Inference,"Cannot create coarse Metal command");
    if(stage>0) {
        int prev=stage-1;Impl::Size size={uint32_t(s.width),uint32_t(s.height),uint32_t(32>>prev),uint32_t(prev)};
        [enc setBuffer:s.outputs[prev] offset:0 atIndex:0];[enc setBuffer:s.states[1-prev%2] offset:0 atIndex:1];
        [enc setBuffer:s.states[prev%2] offset:0 atIndex:2];[enc setBytes:&size length:sizeof(size) atIndex:3];
        s.dispatch(enc,s.update,s.width,s.height,13);
        // The next dispatch reads the state produced by the update above.
        [enc memoryBarrierWithScope:MTLBarrierScopeBuffers];
    }
    Impl::Size size={uint32_t(s.width),uint32_t(s.height),uint32_t(stage==4?1:32>>stage),uint32_t(stage)};
    for(int i=0;i<4;++i)[enc setBuffer:s.frames[i] offset:0 atIndex:i];
    [enc setBuffer:s.states[stage==0?0:(stage-1)%2] offset:0 atIndex:4];
    [enc setBuffer:s.inputs[stage] offset:0 atIndex:5];[enc setBytes:&size length:sizeof(size) atIndex:6];
    s.dispatch(enc,stage==4?s.refine:s.pack,s.width/size.scale,s.height/size.scale,stage==0?15:28);
    [enc endEncoding];[command commit];[command waitUntilCompleted];
    if(command.status!=MTLCommandBufferStatusCompleted)fail(ErrorCode::Inference,command.error.localizedDescription);
    s.awaiting=stage<4;s.finished=stage==4;return s.packed[stage];
}
MLPredictionOptions* CoarseMetal::options(int stage) const {
    if(stage<0 || stage>=4)throw EngineError(ErrorCode::Inference,"Invalid coarse stage");return m_impl->options[stage];
}
void CoarseMetal::accept(int stage,MLMultiArray* output) {
    auto& s=*m_impl;
    if(stage<0 || stage>=4 || stage!=s.next || !s.awaiting)throw EngineError(ErrorCode::Inference,"Out-of-order coarse output");
    int scale=32>>stage;upload(output,s.outputs[stage],s.width/scale,s.height/scale,13);
    s.awaiting=false;++s.next;
}
MLMultiArray* CoarseMetal::flow() const {
    if(!m_impl->finished)throw EngineError(ErrorCode::Inference,"Coarse flow is not ready");return m_impl->finalFlow;
}
}

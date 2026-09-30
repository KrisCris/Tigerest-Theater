// Development harness: one contiguous encoder prediction per new video frame,
// followed by the FP32 GPU motion graph. Alternating fixtures model A→B→A→B.
#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>
#include <sys/resource.h>

using Clock = std::chrono::steady_clock;
static double milliseconds(Clock::time_point start) {
    return std::chrono::duration<double,std::milli>(Clock::now()-start).count();
}
static void fail(NSString* text) { fprintf(stderr,"%s\n",text.UTF8String);exit(1); }
static MLMultiArray* tensor(NSArray* shape) {
    NSError* error=nil;
    MLMultiArray* a=[[MLMultiArray alloc] initWithShape:shape dataType:MLMultiArrayDataTypeFloat32 error:&error];
    if(!a)fail(error.description);
    size_t stride=1;
    for(NSInteger i=shape.count-1;i>=0;--i) {
        if(a.strides[i].unsignedLongLongValue!=stride)fail(@"Non-contiguous input allocation");
        stride*=[shape[i] unsignedLongLongValue];
    }
    return a;
}
static MLModel* load(NSString* path, MLComputeUnits units, NSMutableArray* ownedURLs) {
    NSError* error=nil;
    NSURL* url=[MLModel compileModelAtURL:[NSURL fileURLWithPath:path] error:&error];
    if(!url)fail(error.description);
    [ownedURLs addObject:url];
    MLModelConfiguration* config=[MLModelConfiguration new];config.computeUnits=units;
    MLModel* model=[MLModel modelWithContentsOfURL:url configuration:config error:&error];
    if(!model)fail(error.description);
    return model;
}
static id<MLFeatureProvider> prediction(MLModel* model, NSDictionary* inputs) {
    NSError* error=nil;
    MLDictionaryFeatureProvider* provider=[[MLDictionaryFeatureProvider alloc] initWithDictionary:inputs error:&error];
    if(!provider)fail(error.description);
    id<MLFeatureProvider> prediction=[model predictionFromFeatures:provider error:&error];
    if(!prediction)fail(error.description);
    return prediction;
}
static MLMultiArray* array(id<MLFeatureProvider> prediction, NSString* output) {
    MLMultiArray* result=[prediction featureValueForName:output].multiArrayValue;
    if(!result || (result.dataType!=MLMultiArrayDataTypeFloat32 && result.dataType!=MLMultiArrayDataTypeFloat16))fail(@"Missing float tensor result");
    (void)*static_cast<const volatile unsigned char*>(result.dataPointer);
    return result;
}
static MLMultiArray* predict(MLModel* model, NSDictionary* inputs, NSString* output) { return array(prediction(model,inputs),output); }
static void prepareLow(MLMultiArray* full, MLMultiArray* low, int w, int h, int lw, int lh) {
    const float* src=static_cast<const float*>(full.dataPointer);
    float* dst=static_cast<float*>(low.dataPointer);
    // Matches pad→bilinear resize(scale=.5, align_corners=false). The final
    // partial 2x2 group includes zero padding rather than replicating an edge.
    for(int c=0;c<3;++c)for(int y=0;y<lh;++y)for(int x=0;x<lw;++x) {
        const int sx=x*2,sy=y*2;
        float sum=0;
        for(int dy=0;dy<2;++dy)for(int dx=0;dx<2;++dx)
            if(sx+dx<w && sy+dy<h)sum+=src[(size_t(c)*h+sy+dy)*w+sx+dx];
        dst[(size_t(c)*lh+y)*lw+x]=sum*.25f;
    }
}
static void collect(MLComputePlan* plan, MLModelStructureProgramBlock* block, NSMutableDictionary* counts) {
    for(MLModelStructureProgramOperation* op in block.operations) {
        auto usage=[plan computeDeviceUsageForMLProgramOperation:op];
        NSString* name=usage ? NSStringFromClass([(NSObject*)usage.preferredComputeDevice class]) : @"unknown";
        counts[name]=@([counts[name] unsignedLongLongValue]+1);
        for(MLModelStructureProgramBlock* nested in op.blocks)collect(plan,nested,counts);
    }
}
static NSDictionary* devicePlan(NSURL* url, MLComputeUnits units) {
    MLModelConfiguration* config=[MLModelConfiguration new];config.computeUnits=units;
    dispatch_semaphore_t ready=dispatch_semaphore_create(0);
    __block MLComputePlan* plan=nil;
    [MLComputePlan loadContentsOfURL:url configuration:config completionHandler:^(MLComputePlan* p,NSError* e){
        plan=p; if(e)fprintf(stderr,"%s\n",e.description.UTF8String);dispatch_semaphore_signal(ready);
    }];
    if(dispatch_semaphore_wait(ready,dispatch_time(DISPATCH_TIME_NOW,120*NSEC_PER_SEC)))fail(@"Plan timeout");
    NSMutableDictionary* counts=[NSMutableDictionary dictionary];
    for(MLModelStructureProgramFunction* function in plan.modelStructure.program.functions.allValues)
        collect(plan,function.block,counts);
    return counts;
}

int main(int argc,const char* argv[]) {
    @autoreleasepool {
        NSMutableDictionary<NSString*,NSString*>* args=[NSMutableDictionary dictionary];
        for(int i=1;i+1<argc;i+=2)args[@(argv[i])]=@(argv[i+1]);
        NSString* directory=args[@"--model-dir"],*fixtures=args[@"--fixtures"],*output=args[@"--output"];
        if(!directory || !fixtures || !output)fail(@"Required: --model-dir --fixtures --output");
        NSData* metadata=[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"manifest.json"]];
        NSDictionary* manifest=metadata ? [NSJSONSerialization JSONObjectWithData:metadata options:0 error:nil] : nil;
        const bool splitRefine=[manifest[@"pipeline"] isEqual:@"ane-encoder-refine-gpu-motion"];
        if((![manifest[@"pipeline"] isEqual:@"ane-encoder-gpu-motion"] && !splitRefine) || [manifest[@"grid_scale"] doubleValue]!=.5)
            fail(@"This harness requires the half-grid split model");
        const int w=[manifest[@"width"] intValue],h=[manifest[@"height"] intValue];
        const int lw=[manifest[@"low_width"] intValue],lh=[manifest[@"low_height"] intValue];
        const int warmup=args[@"--warmup"] ? args[@"--warmup"].intValue : 30;
        const int iterations=args[@"--iterations"] ? args[@"--iterations"].intValue : 120;
        const int reset=args[@"--reset-at"] ? args[@"--reset-at"].intValue : -1;
        const bool reuse=!args[@"--reuse"] || args[@"--reuse"].intValue!=0;
        if(w<2 || h<2 || lw<w/2 || lh<h/2 || warmup<0 || iterations<1)fail(@"Invalid dimensions/counts");
        NSString* compute=args[@"--encoder-compute"] ?: @"cpu-ane";
        MLComputeUnits units=MLComputeUnitsCPUAndNeuralEngine;
        if([compute isEqual:@"cpu-gpu"])units=MLComputeUnitsCPUAndGPU;
        else if(![compute isEqual:@"cpu-ane"])fail(@"Invalid encoder compute policy");
        NSMutableArray* urls=[NSMutableArray array];
        auto begin=Clock::now();
        MLModel* encoder=load([directory stringByAppendingPathComponent:@"Encoder.mlpackage"],units,urls);
        MLModel* motion=load([directory stringByAppendingPathComponent:splitRefine?@"Coarse.mlpackage":@"Motion.mlpackage"],MLComputeUnitsCPUAndGPU,urls);
        MLModel* refine=splitRefine?load([directory stringByAppendingPathComponent:@"Refine.mlpackage"],units,urls):nil;
        MLModel* warp=splitRefine?load([directory stringByAppendingPathComponent:@"Warp.mlpackage"],MLComputeUnitsCPUAndGPU,urls):nil;
        const double loadMs=milliseconds(begin);
        NSMutableArray<MLMultiArray*>* full=[NSMutableArray array],*low=[NSMutableArray array];
        for(int i=0;i<2;++i) {
            MLMultiArray* f=tensor(@[@1,@3,@(h),@(w)]);
            NSData* bytes=[NSData dataWithContentsOfFile:[fixtures stringByAppendingPathComponent:[NSString stringWithFormat:@"frame%d.f32",i]]];
            if(bytes.length!=f.count*sizeof(float))fail(@"Fixture dimensions do not match model");
            memcpy(f.dataPointer,bytes.bytes,bytes.length);[full addObject:f];
            [low addObject:tensor(@[@1,@3,@(lh),@(lw)])];
        }
        NSMutableArray* totalTimes=[NSMutableArray array],*prepareTimes=[NSMutableArray array],
                      *encoderTimes=[NSMutableArray array],*motionTimes=[NSMutableArray array],*copyTimes=[NSMutableArray array];
        NSMutableArray* refineTimes=[NSMutableArray array],*warpTimes=[NSMutableArray array];
        MLMultiArray* previousFeature=nil;
        int encoderCalls=0,cacheHits=0;
        std::vector<float> flat(size_t(w)*h*3);
        bool finite=true;
        for(int i=0;i<warmup+iterations;++i) {
            @autoreleasepool {
                const int a=i%2,b=1-a;
                if(!reuse || i==reset)previousFeature=nil;
                begin=Clock::now();
                auto stage=Clock::now();
                if(!previousFeature)prepareLow(full[a],low[a],w,h,lw,lh);
                prepareLow(full[b],low[b],w,h,lw,lh);
                const double prepMs=milliseconds(stage);stage=Clock::now();
                if(!previousFeature) {
                    previousFeature=predict(encoder,@{@"rgb":low[a]},@"features");++encoderCalls;
                } else ++cacheHits;
                MLMultiArray* nextFeature=predict(encoder,@{@"rgb":low[b]},@"features");++encoderCalls;
                const double encMs=milliseconds(stage);stage=Clock::now();
                MLMultiArray* result=nil;
                double motionMs=0,refineMs=0,warpMs=0;
                if(splitRefine) {
                    id<MLFeatureProvider> coarse=prediction(motion,@{@"low0":low[a],@"low1":low[b],
                                                                     @"features0":previousFeature,@"features1":nextFeature});
                    MLMultiArray* packed=array(coarse,@"refine_input"),*flow=array(coarse,@"coarse_flow");
                    motionMs=milliseconds(stage);stage=Clock::now();
                    id<MLFeatureProvider> refined=prediction(refine,@{@"refine_input":packed});
                    MLMultiArray* delta=array(refined,@"delta"),*mask=array(refined,@"mask");
                    refineMs=milliseconds(stage);stage=Clock::now();
                    result=predict(warp,@{@"frame0":full[a],@"frame1":full[b],@"coarse_flow":flow,@"delta":delta,@"mask":mask},@"interpolated");
                    warpMs=milliseconds(stage);stage=Clock::now();
                } else {
                    result=predict(motion,@{@"frame0":full[a],@"frame1":full[b],@"low0":low[a],@"low1":low[b],
                                           @"features0":previousFeature,@"features1":nextFeature},@"interpolated");
                    motionMs=milliseconds(stage);stage=Clock::now();
                }
                if(result.dataType!=MLMultiArrayDataTypeFloat32)fail(@"Final output must preserve float32");
                if(![result.shape isEqual:@[@1,@3,@(h),@(w)]])fail(@"Output shape changed");
                const float* data=static_cast<const float*>(result.dataPointer);
                size_t sc=result.strides[1].unsignedLongLongValue,sy=result.strides[2].unsignedLongLongValue,sx=result.strides[3].unsignedLongLongValue;
                for(int c=0;c<3;++c)for(int y=0;y<h;++y) {
                    const float* src=data+c*sc+y*sy;float* dst=flat.data()+(size_t(c)*h+y)*w;
                    if(sx==1)memcpy(dst,src,size_t(w)*sizeof(float));
                    else for(int x=0;x<w;++x)dst[x]=src[x*sx];
                    for(int x=0;x<w;++x)finite&=std::isfinite(dst[x]);
                }
                const double copyMs=milliseconds(stage),totalMs=milliseconds(begin);
                previousFeature=nextFeature;
                if(i>=warmup) {
                    [totalTimes addObject:@(totalMs)];[prepareTimes addObject:@(prepMs)];
                    [encoderTimes addObject:@(encMs)];[motionTimes addObject:@(motionMs)];[copyTimes addObject:@(copyMs)];
                    [refineTimes addObject:@(refineMs)];[warpTimes addObject:@(warpMs)];
                }
            }
        }
        NSString* raw=[output.stringByDeletingPathExtension stringByAppendingPathExtension:@"f32"];
        if(![[NSData dataWithBytes:flat.data() length:flat.size()*sizeof(float)] writeToFile:raw atomically:YES])fail(@"Output write failed");
        NSArray* sorted=[totalTimes sortedArrayUsingSelector:@selector(compare:)];
        struct rusage memory{};getrusage(RUSAGE_SELF,&memory);
        NSDictionary* report=@{@"width":@(w),@"height":@(h),@"warmup":@(warmup),@"iterations":@(iterations),
            @"compute":compute,@"pair_ms":totalTimes,@"prepare_ms":prepareTimes,@"encoder_ms":encoderTimes,
            @"motion_ms":motionTimes,@"output_copy_ms":copyTimes,@"load_ms":@(loadMs),
            @"refinement_ms":refineTimes,@"warp_ms":warpTimes,@"refinement_calls":@(splitRefine?(warmup+iterations):0),
            @"p50_ms":sorted[(NSUInteger)ceil(iterations*.5)-1],@"p95_ms":sorted[(NSUInteger)ceil(iterations*.95)-1],
            @"encoder_calls":@(encoderCalls),@"feature_cache_hits":@(cacheHits),@"reuse":@(reuse),@"reset_at":@(reset),
            @"output_finite":@(finite),@"final_pair_reversed":@((warmup+iterations-1)%2!=0),@"peak_rss_bytes":@(memory.ru_maxrss),
            @"thermal_state":@([NSProcessInfo processInfo].thermalState),@"generated_frames":@(iterations),
            @"encoder_plan":devicePlan(urls[0],units),@"motion_plan":devicePlan(urls[1],MLComputeUnitsCPUAndGPU),
            @"refinement_plan":splitRefine?devicePlan(urls[2],units):@{},@"warp_plan":splitRefine?devicePlan(urls[3],MLComputeUnitsCPUAndGPU):@{},
            @"runtime_ane_evidence":@NO,@"manifest":manifest,
            @"timing_scope":@"Low-grid preprocessing, cached encoder, GPU motion and float output copy. Excludes decode/full-resolution input copies."};
        NSData* json=[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];
        if(!json || ![json writeToFile:output atomically:YES])fail(@"Report write failed");
        fprintf(stderr,"Encoder %s: p50 %.2f ms, p95 %.2f ms, calls %d, cache hits %d\n",compute.UTF8String,
                [report[@"p50_ms"] doubleValue],[report[@"p95_ms"] doubleValue],encoderCalls,cacheHits);
        encoder=nil;motion=nil;refine=nil;warp=nil;
        for(NSURL* url in urls)[[NSFileManager defaultManager] removeItemAtURL:url error:nil];
    }
}

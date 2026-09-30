// Compare complete native engine calls, including checked input/output copies.
#import <Foundation/Foundation.h>
#include "RifeEngine.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iostream>
#include <thread>
#include <sys/resource.h>

int main(int argc,const char* argv[]) {
    @autoreleasepool { try {
        NSMutableDictionary* args=[NSMutableDictionary dictionary];
        for(int i=1;i+1<argc;i+=2)args[@(argv[i])]=@(argv[i+1]);
        NSString* directory=args[@"--model-dir"],*output=args[@"--output"];
        if(!directory || !output)throw std::runtime_error("Required: --model-dir --output");
        const int warmup=args[@"--warmup"]?[args[@"--warmup"] intValue]:30;
        const int iterations=args[@"--iterations"]?[args[@"--iterations"] intValue]:120;
        const double interval=[args[@"--interval-ms"] doubleValue];
        if(warmup<0 || warmup>100000 || iterations<1 || iterations>100000 || !std::isfinite(interval) || interval<0 || interval>1000)
            throw std::runtime_error("Invalid benchmark counts or interval");
        const bool fused=[args[@"--pipeline"] isEqual:@"split-coarse-metal"];
        const bool metal=[args[@"--pipeline"] isEqual:@"split-metal"] || fused;
        const bool split=[args[@"--pipeline"] isEqual:@"split"] || metal;
        if(args[@"--pipeline"] && !split && ![args[@"--pipeline"] isEqual:@"monolithic"])
            throw std::runtime_error("Invalid pipeline");
        NSString* compute=args[@"--compute"]?:@"cpu-gpu";
        rife::ComputePolicy policy;
        if([compute isEqual:@"cpu-ane"])policy=rife::ComputePolicy::CPUAndNeuralEngine;
        else if([compute isEqual:@"cpu-gpu"])policy=rife::ComputePolicy::CPUAndGPU;
        else throw std::runtime_error("Invalid compute policy");
        constexpr int w=1920,h=1080;
        std::vector<float> pixels[2];
        rife::FrameView views[2]{};
        for(int i=0;i<2;++i) {
            pixels[i].resize(size_t(w)*h*3);
            NSString* file=[directory stringByAppendingPathComponent:[NSString stringWithFormat:@"fixture/frame%d.f32",i]];
            std::ifstream stream(file.UTF8String,std::ios::binary);
            stream.read(reinterpret_cast<char*>(pixels[i].data()),pixels[i].size()*sizeof(float));
            if(!stream.good() || stream.peek()!=EOF)throw std::runtime_error("Wrong fixture length");
            views[i].width=w;views[i].height=h;
            for(int c=0;c<3;++c) {views[i].planes[c]=pixels[i].data()+size_t(c)*w*h;views[i].strides[c]=w*sizeof(float);}
        }
        rife::EngineConfig config{directory.UTF8String,policy,w,h};
        config.pipeline=fused?rife::Pipeline::SplitCoarseMetal:(metal?rife::Pipeline::SplitEncoderRefineMetal:
            (split?rife::Pipeline::SplitEncoderRefine:rife::Pipeline::Monolithic));
        auto engine=rife::RifeEngine::create(config);
        NSMutableArray* times=[NSMutableArray array];
        int hits=0,encoders=0,directBuffers=0;
        int deadlineOverruns=0;
        using Clock=std::chrono::steady_clock;
        Clock::time_point measuredStart,measuredEnd;
        rife::FrameBuffer result;
        for(int i=0;i<warmup+iterations;++i) {
            if(i==warmup)measuredStart=Clock::now();
            if(interval && i>warmup)
                std::this_thread::sleep_until(measuredStart+std::chrono::duration<double,std::milli>((i-warmup)*interval));
            views[i%2].identity={1,i};views[1-i%2].identity={1,i+1};
            result=engine->interpolate(views[i%2],views[1-i%2],.5f);
            if(i>=warmup) {
                [times addObject:@(result.inferenceMs)];
                measuredEnd=Clock::now();
                if(interval && measuredEnd>measuredStart+std::chrono::duration<double,std::milli>((i-warmup+1)*interval))++deadlineOverruns;
            }
            hits+=result.featureCacheHit;encoders+=result.encoderPredictions;
            directBuffers+=result.directWarpBuffers;
        }
        NSString* raw=[output.stringByDeletingPathExtension stringByAppendingPathExtension:@"f32"];
        if(![[NSData dataWithBytes:result.pixels.data() length:result.pixels.size()*sizeof(float)] writeToFile:raw atomically:YES])
            throw std::runtime_error("Could not write output frame");
        NSArray* sorted=[times sortedArrayUsingSelector:@selector(compare:)];
        struct rusage memory{};getrusage(RUSAGE_SELF,&memory);
        const double measuredSeconds=std::chrono::duration<double>(measuredEnd-measuredStart).count();
        NSDictionary* report=@{@"width":@(w),@"height":@(h),@"warmup":@(warmup),@"iterations":@(iterations),
            @"pipeline":args[@"--pipeline"]?:@"monolithic",@"compute":compute,@"pair_ms":times,@"interval_ms":@(interval),
            @"p50_ms":sorted[(NSUInteger)ceil(iterations*.5)-1],@"p95_ms":sorted[(NSUInteger)ceil(iterations*.95)-1],
            @"pacing":@"absolute deadlines after warmup",@"deadline_overruns":@(deadlineOverruns),
            @"measured_seconds":@(measuredSeconds),@"actual_predictions_per_second":@(iterations/measuredSeconds),
            @"encoder_calls":@(encoders),@"feature_cache_hits":@(hits),@"final_pair_reversed":@((warmup+iterations-1)%2!=0),
            @"direct_warp_buffers":@(directBuffers),
            @"peak_rss_bytes":@(memory.ru_maxrss),@"thermal_state":@([NSProcessInfo processInfo].thermalState),
            @"runtime_ane_evidence":@NO,@"output_finite":@YES,
            @"timing_scope":@"Complete RifeEngine call: checked input copies, preprocessing, prediction, output allocation/checks/copy. Excludes decode/color conversion; cached immutable first frame is reused on the split path."};
        NSData* json=[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];
        if(!json || ![json writeToFile:output atomically:YES])throw std::runtime_error("Could not write report");
        std::cout<<"Engine "<<[report[@"pipeline"] UTF8String]<<" "<<compute.UTF8String
                 <<": p50 "<<[report[@"p50_ms"] doubleValue]<<" ms, p95 "<<[report[@"p95_ms"] doubleValue]<<" ms\n";
        return 0;
    } catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;} }
}

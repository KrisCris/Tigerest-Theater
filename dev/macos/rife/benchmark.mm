#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <sys/resource.h>
#include <vector>

using Clock = std::chrono::steady_clock;
static double elapsed(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

static void fail(NSString* message) {
    fprintf(stderr, "%s\n", message.UTF8String);
    exit(1);
}

static MLMultiArray* inputArray(NSString* path, NSArray<NSNumber*>* shape) {
    NSError* error = nil;
    MLMultiArray* array = [[MLMultiArray alloc] initWithShape:shape dataType:MLMultiArrayDataTypeFloat32 error:&error];
    if (!array) fail(error.description);
    NSData* data = [NSData dataWithContentsOfFile:path];
    if (!data || data.length != array.count * sizeof(float)) fail(@"Input tensor size mismatch");
    size_t stride = 1;
    for (NSInteger i = shape.count - 1; i >= 0; --i) {
        if (array.strides[i].unsignedLongLongValue != stride) fail(@"Non-contiguous input tensor");
        stride *= shape[i].unsignedLongLongValue;
    }
    memcpy(array.dataPointer, data.bytes, data.length);
    return array;
}

static void inspectBlock(MLComputePlan* plan, MLModelStructureProgramBlock* block,
                         NSMutableDictionary* devices, NSMutableArray* operations) {
    for (MLModelStructureProgramOperation* op in block.operations) {
        MLComputePlanDeviceUsage* usage = [plan computeDeviceUsageForMLProgramOperation:op];
        NSString* name = usage ? NSStringFromClass([(NSObject*)usage.preferredComputeDevice class]) : @"unknown";
        devices[name] = @([devices[name] unsignedLongLongValue] + 1);
        MLComputePlanCost* cost = [plan estimatedCostOfMLProgramOperation:op];
        [operations addObject:@{@"operator": op.operatorName, @"preferred_device": name,
                               @"estimated_cost": cost ? @(cost.weight) : @0}];
        for (MLModelStructureProgramBlock* nested in op.blocks) inspectBlock(plan, nested, devices, operations);
    }
}

int main(int argc, const char* argv[]) {
    @autoreleasepool {
        NSMutableDictionary<NSString*, NSString*>* args = [NSMutableDictionary dictionary];
        for (int i = 1; i + 1 < argc; i += 2) args[@(argv[i])] = @(argv[i + 1]);
        for (NSString* key in @[@"--model", @"--input-a", @"--input-b", @"--output"])
            if (!args[key]) fail([@"Missing option " stringByAppendingString:key]);
        NSString* compute = args[@"--compute"] ?: @"all";
        NSInteger warmup = args[@"--warmup"] ? args[@"--warmup"].integerValue : 30;
        NSInteger iterations = args[@"--iterations"] ? args[@"--iterations"].integerValue : 120;
        if (warmup < 0 || iterations < 1) fail(@"Invalid warmup/iterations");
        MLModelConfiguration* config = [MLModelConfiguration new];
        if ([compute isEqualToString:@"all"]) config.computeUnits = MLComputeUnitsAll;
        else if ([compute isEqualToString:@"cpu-ane"]) config.computeUnits = MLComputeUnitsCPUAndNeuralEngine;
        else if ([compute isEqualToString:@"cpu-gpu"]) config.computeUnits = MLComputeUnitsCPUAndGPU;
        else fail(@"Unknown compute policy");
        NSError* error = nil;
        auto begin = Clock::now();
        NSURL* source = [NSURL fileURLWithPath:args[@"--model"]];
        NSURL* compiled = [source.pathExtension isEqualToString:@"mlmodelc"] ? source :
            [MLModel compileModelAtURL:source error:&error];
        if (!compiled) fail(error.description);
        MLModel* model = [MLModel modelWithContentsOfURL:compiled configuration:config error:&error];
        if (!model) fail(error.description);
        double loadMs = elapsed(begin);
        NSArray* shape = model.modelDescription.inputDescriptionsByName[@"frame0"].multiArrayConstraint.shape;
        if (shape.count != 4 || [shape[0] intValue] != 1 || [shape[1] intValue] != 3) fail(@"Expected NCHW RGB tensors");
        MLMultiArray* frame0 = inputArray(args[@"--input-a"], shape);
        MLMultiArray* frame1 = inputArray(args[@"--input-b"], shape);
        MLDictionaryFeatureProvider* inputs = [[MLDictionaryFeatureProvider alloc]
            initWithDictionary:@{@"frame0": [MLFeatureValue featureValueWithMultiArray:frame0],
                                 @"frame1": [MLFeatureValue featureValueWithMultiArray:frame1]} error:&error];
        if (!inputs) fail(error.description);
        NSMutableArray* samples = [NSMutableArray array];
        MLMultiArray* output = nil;
        for (NSInteger i = -warmup; i < iterations; ++i) {
            @autoreleasepool {
                begin = Clock::now();
                id<MLFeatureProvider> prediction = [model predictionFromFeatures:inputs error:&error];
                if (!prediction) fail(error.description);
                output = [prediction featureValueForName:@"interpolated"].multiArrayValue;
                if (!output || output.dataType != MLMultiArrayDataTypeFloat32) fail(@"Missing float32 output");
                const volatile float* materialized = (const volatile float*)output.dataPointer;
                (void)*materialized;
                const double duration = elapsed(begin);
                if (i >= 0) [samples addObject:@(duration)];
            }
        }
        const int height = [shape[2] intValue], width = [shape[3] intValue];
        if (![output.shape isEqualToArray:shape]) fail(@"Output shape mismatch");
        std::vector<float> flat(3 * height * width);
        const float* values = (const float*)output.dataPointer;
        bool finite = true;
        for (int c = 0; c < 3; ++c) for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
            float v = values[c * output.strides[1].longLongValue + y * output.strides[2].longLongValue + x * output.strides[3].longLongValue];
            flat[(c * height + y) * width + x] = v;
            finite &= std::isfinite(v);
        }
        NSString* rawPath = [args[@"--output"].stringByDeletingPathExtension stringByAppendingPathExtension:@"f32"];
        if (![[NSData dataWithBytes:flat.data() length:flat.size() * sizeof(float)] writeToFile:rawPath atomically:YES]) fail(@"Cannot save tensor");
        NSArray* sorted = [samples sortedArrayUsingSelector:@selector(compare:)];
        NSMutableDictionary* devices = [NSMutableDictionary dictionary];
        NSMutableArray* operations = [NSMutableArray array];
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block MLComputePlan* plan = nil;
        [MLComputePlan loadContentsOfURL:compiled configuration:config completionHandler:^(MLComputePlan* p, NSError* e) {
            plan = p;
            if (e) fprintf(stderr, "Compute plan: %s\n", e.description.UTF8String);
            dispatch_semaphore_signal(semaphore);
        }];
        if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC)) != 0)
            fail(@"Timed out loading compute plan");
        if (plan.modelStructure.program) for (MLModelStructureProgramFunction* function in plan.modelStructure.program.functions.allValues)
            inspectBlock(plan, function.block, devices, operations);
        struct rusage usage = {};
        getrusage(RUSAGE_SELF, &usage);
        NSDictionary* report = @{
            @"width": @(width), @"height": @(height), @"compute": compute, @"load_ms": @(loadMs),
            @"warmup": @(warmup), @"iterations": @(iterations), @"generated_frames": @(iterations), @"pair_ms": samples,
            @"p50_ms": sorted[(NSUInteger)ceil(iterations * .5) - 1],
            @"p95_ms": sorted[(NSUInteger)ceil(iterations * .95) - 1],
            @"peak_rss_bytes": @(usage.ru_maxrss), @"output_finite": @(finite),
            @"thermal_state": @([NSProcessInfo processInfo].thermalState),
            @"os": [NSProcessInfo processInfo].operatingSystemVersionString,
            @"plan_devices": devices, @"plan_operations": operations, @"runtime_ane_evidence": @NO,
            @"timing_scope": @"Synchronous Core ML prediction with reused tensors; excludes video decode/color conversion"
        };
        NSData* json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:&error];
        if (!json || ![json writeToFile:args[@"--output"] atomically:YES]) fail(@"Cannot save benchmark JSON");
        fprintf(stderr, "%s %dx%d p50=%.2f ms p95=%.2f ms\n", compute.UTF8String, width, height,
                [report[@"p50_ms"] doubleValue], [report[@"p95_ms"] doubleValue]);
        if (![source.pathExtension isEqualToString:@"mlmodelc"])
            [[NSFileManager defaultManager] removeItemAtURL:compiled error:nil];
    }
    return 0;
}

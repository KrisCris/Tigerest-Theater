// Standalone, opt-in device probe. Not linked into the player application.
#import <UIKit/UIKit.h>
#include "RifeEngine.h"
#include <cmath>
#include <chrono>
static NSURL* reportURL() {
    return [[[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"rife-ipad-probe.json"];
}
static void save(NSDictionary* report) {
    [[NSFileManager defaultManager] createDirectoryAtURL:[reportURL() URLByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
    NSData* data = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];
    [data writeToURL:reportURL() atomically:YES];
}
static void probe() {
    @autoreleasepool {
        NSMutableDictionary* report = [@{@"stage":@"load", @"width":@1920, @"height":@1080, @"pipeline":@"split-coarse-metal", @"samples":[NSMutableArray array]} mutableCopy];
        save(report);
        try {
            rife::EngineConfig config;
            config.modelDirectory = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"model"].UTF8String;
            config.width=1920; config.height=1080; config.pipeline=rife::Pipeline::SplitCoarseMetal;
            config.computePolicy=rife::ComputePolicy::CPUAndNeuralEngine;
            auto engine=rife::RifeEngine::create(config);
            report[@"stage"]=@"inference"; save(report);
            const size_t plane=1920*1080;
            std::vector<float> first(plane*3,0.25f),second(plane*3,0.25f);
            for(int iteration=0;iteration<6;++iteration) {
                // A constant-frame case checks numerical preservation, then moving
                // gradients exercise non-trivial motion, reuse, and reset.
                if(iteration>0) for(size_t i=0;i<plane*3;++i) {
                    first[i]=float((i%1920+iteration*8)%1920)/1919;
                    second[i]=float((i%1920+(iteration+1)*8)%1920)/1919;
                }
                rife::FrameView a{{first.data(),first.data()+plane,first.data()+2*plane},{1920*4,1920*4,1920*4},1920,1080,{1,iteration}};
                rife::FrameView b{{second.data(),second.data()+plane,second.data()+2*plane},{1920*4,1920*4,1920*4},1920,1080,{1,iteration+1}};
                // The first constant pair differs from the subsequent gradient sequence.
                if(iteration==1) engine->reset();
                auto frame=engine->interpolate(a,b,0.5f);
                bool finite=true; double constantError=0,checksum=0;
                for(float value:frame.pixels) {finite &= std::isfinite(value);constantError+=std::abs(value-.25f);checksum+=value;}
                [report[@"samples"] addObject:@{@"iteration":@(iteration),@"inferenceMs":@(frame.inferenceMs),@"finite":@(finite),@"pixels":@(frame.pixels.size()),@"mean":@(checksum/frame.pixels.size()),@"constantMAE":@(constantError/frame.pixels.size()),@"featureCacheHit":@(frame.featureCacheHit),@"encoderPredictions":@(frame.encoderPredictions),@"directWarpBuffers":@(frame.directWarpBuffers)}];
                save(report);
                if(!finite || frame.pixels.size()!=plane*3 || (iteration==0 && constantError/frame.pixels.size()>.005)) throw std::runtime_error("Numerical validation failed");
            }
            report[@"stage"]=@"complete"; report[@"result"]=@"success";
        } catch(const std::exception& error) {report[@"result"]=@"failed";report[@"error"]=[NSString stringWithUTF8String:error.what()];}
        save(report);
    }
}
@interface ProbeSceneDelegate : UIResponder<UIWindowSceneDelegate>
@property(strong,nonatomic) UIWindow* window;
@end
@implementation ProbeSceneDelegate
- (void)scene:(UIScene*)scene willConnectToSession:(UISceneSession*)session options:(UISceneConnectionOptions*)options {
    self.window=[[UIWindow alloc] initWithWindowScene:(UIWindowScene*)scene];
    UIViewController* controller=[UIViewController new];controller.view.backgroundColor=UIColor.blackColor;
    UILabel* label=[[UILabel alloc] initWithFrame:CGRectMake(40,100,900,200)];label.numberOfLines=0;label.textColor=UIColor.whiteColor;label.text=@"RIFE iPad 兼容性验证\n正在检查 Core ML 与 Metal，完成后会恢复正常播放器。";[controller.view addSubview:label];
    self.window.rootViewController=controller;[self.window makeKeyAndVisible];
    UIApplication.sharedApplication.idleTimerDisabled=YES;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{probe();dispatch_async(dispatch_get_main_queue(), ^{label.text=@"RIFE 验证已结束，正在恢复播放器。";});});
}
@end
@interface ProbeDelegate : UIResponder<UIApplicationDelegate>
@end
@implementation ProbeDelegate
- (BOOL)application:(UIApplication*)application didFinishLaunchingWithOptions:(NSDictionary*)options {save(@{@"stage":@"application-start"});return YES;}
- (UISceneConfiguration*)application:(UIApplication*)application configurationForConnectingSceneSession:(UISceneSession*)session options:(UISceneConnectionOptions*)options {
    UISceneConfiguration* configuration=[[UISceneConfiguration alloc] initWithName:@"Probe" sessionRole:session.role];configuration.delegateClass=ProbeSceneDelegate.class;return configuration;
}
@end
int main(int argc,char** argv) { @autoreleasepool {save(@{@"stage":@"main"});return UIApplicationMain(argc,argv,nil,NSStringFromClass(ProbeDelegate.class));} }

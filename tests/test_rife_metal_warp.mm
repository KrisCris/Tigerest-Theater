#include "RifeMetalWarp.h"
#include "RifeTypes.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <vector>

static void check(bool value,const char* message) {if(!value)throw std::runtime_error(message);}
static MLMultiArray* allocate(int channels,MLMultiArrayDataType type) {
    NSError* error=nil;
    MLMultiArray* result=[[MLMultiArray alloc] initWithShape:@[@1,@(channels),@128,@128] dataType:type error:&error];
    check(result!=nil,"test tensor allocation");return result;
}
int main() {
    @autoreleasepool {try {
        constexpr int w=7,h=5,low=128,plane=low*low;
        auto warp=rife::MetalWarp::create(w,h,low,low);
        float* frames[2]={static_cast<float*>(warp->input(0).dataPointer),static_cast<float*>(warp->input(1).dataPointer)};
        for(int n=0;n<2;++n)for(int c=0;c<3;++c)for(int y=0;y<h;++y)for(int x=0;x<w;++x)
            frames[n][(c*h+y)*w+x]=.1f+n*.3f+c*.1f+x*.02f+y*.01f;
        MLMultiArray* coarse=allocate(4,MLMultiArrayDataTypeFloat32);
        MLMultiArray* delta=allocate(4,MLMultiArrayDataTypeFloat16);
        // Padded rows exercise non-contiguous model output uploads.
        std::vector<_Float16> maskData((low+8)*low);
        MLMultiArray* mask=[[MLMultiArray alloc] initWithDataPointer:maskData.data() shape:@[@1,@1,@128,@128]
            dataType:MLMultiArrayDataTypeFloat16 strides:@[@(maskData.size()),@(maskData.size()),@(low+8),@1]
            deallocator:nil error:nil];
        const float deltas[]={.125f,-.25f,.5f,-.125f};
        for(int c=0;c<4;++c)std::fill_n(static_cast<_Float16*>(delta.dataPointer)+c*plane,plane,static_cast<_Float16>(deltas[c]));
        const float cases[][5]={{0,0,0,0,0},{1,.5f,-1,-.5f,0},{-.25f,.25f,.375f,-.375f,2},
                               {10000,10000,10000,10000,0},{-10000,-10000,-10000,-10000,0}};
        auto sample=[&](int n,int c,double x,double y) {
            x=std::clamp(x,0.,255.);y=std::clamp(y,0.,255.);
            int x0=int(std::floor(x)),y0=int(std::floor(y)),x1=std::min(255,x0+1),y1=std::min(255,y0+1);
            double fx=x-x0,fy=y-y0;
            auto pixel=[&](int xx,int yy){return xx<w && yy<h ? double(frames[n][(c*h+yy)*w+xx]) : 0.;};
            return (pixel(x0,y0)*(1-fx)+pixel(x1,y0)*fx)*(1-fy)+(pixel(x0,y1)*(1-fx)+pixel(x1,y1)*fx)*fy;
        };
        for(const auto& item:cases) {
            for(int c=0;c<4;++c)std::fill_n(static_cast<float*>(coarse.dataPointer)+c*plane,plane,item[c]);
            std::fill(maskData.begin(),maskData.end(),static_cast<_Float16>(item[4]));
            for(int first:{0,1}) {
                MLMultiArray* result=warp->predict(coarse,delta,mask,first,1-first);
                const float* values=static_cast<const float*>(result.dataPointer);
                double weight=1./(1.+std::exp(-item[4]));
                for(int c=0;c<3;++c)for(int y=0;y<h;++y)for(int x=0;x<w;++x) {
                    double expected=sample(first,c,x+2*(item[0]+deltas[0]),y+2*(item[1]+deltas[1]))*weight+
                        sample(1-first,c,x+2*(item[2]+deltas[2]),y+2*(item[3]+deltas[3]))*(1-weight);
                    check(std::abs(values[(c*h+y)*w+x]-expected)<1e-5,"Metal warp coordinate, padding or mask disagreement");
                }
            }
        }
        // A producer can fill the shared output backings directly. The Metal
        // stage must then consume those buffers without an intervening upload.
        MLMultiArray* backedCoarse=warp->coarseOptions().outputBackings[@"coarse_flow"];
        MLMultiArray* backedDelta=warp->refineOptions().outputBackings[@"delta"];
        MLMultiArray* backedMask=warp->refineOptions().outputBackings[@"mask"];
        std::fill_n(static_cast<float*>(backedCoarse.dataPointer),4*plane,0.f);
        std::fill_n(static_cast<_Float16*>(backedDelta.dataPointer),4*plane,static_cast<_Float16>(0));
        std::fill_n(static_cast<_Float16*>(backedMask.dataPointer),plane,static_cast<_Float16>(0));
        MLMultiArray* direct=warp->predict(backedCoarse,backedDelta,backedMask,0,1);
        check(warp->directBufferCount()==3,"shared backing detection");
        for(int i=0;i<w*h*3;++i)
            check(std::abs(static_cast<float*>(direct.dataPointer)[i]-(frames[0][i]+frames[1][i])*.5f)<1e-5,"direct backing content");
        bool rejected=false;
        try {warp->predict(coarse,delta,coarse,0,1);}catch(const rife::EngineError& e){rejected=e.code()==rife::ErrorCode::Inference;}
        check(rejected,"Metal tensor dtype/shape rejection");
        std::cout<<"Metal warp: fractional motion, masks, padded borders, odd size and strided inputs passed\n";
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
}

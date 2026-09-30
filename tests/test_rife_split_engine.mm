#include "RifeEngine.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>

using namespace rife;
static void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}
static std::vector<float> read(const std::string& path, size_t count) {
    std::vector<float> out(count);
    std::ifstream file(path, std::ios::binary);
    file.read(reinterpret_cast<char*>(out.data()), count*sizeof(float));
    check(file.good() && file.peek()==EOF, "fixture length");
    return out;
}
static void parity(const FrameBuffer& frame, const std::vector<float>& reference) {
    check(frame.pixels.size()==reference.size(), "shape");
    double mae=0, mse=0;
    for (size_t i=0;i<reference.size();++i) {
        check(std::isfinite(frame.pixels[i]), "finite output");
        const double d=frame.pixels[i]-reference[i];mae+=std::abs(d);mse+=d*d;
    }
    check(mae/reference.size()<=.005 && mse/reference.size()<=.0001, "reference parity");
}
int main(int argc, char** argv) {
    try {
        check(argc>=2 && argc<=4, "usage: test_rife_split_engine <model-dir> [--metal] [--benchmark]");
        bool metal=false,coarse=false,benchmark=false;
        for(int i=2;i<argc;++i) {metal|=std::string(argv[i])=="--metal";coarse|=std::string(argv[i])=="--coarse";benchmark|=std::string(argv[i])=="--benchmark";}
        const std::string directory=argv[1];
        constexpr int w=1920,h=1080;
        const size_t count=size_t(w)*h*3;
        auto a=read(directory+"/fixture/frame0.f32",count);
        auto b=read(directory+"/fixture/frame1.f32",count);
        auto forward=read(directory+"/fixture/reference.f32",count);
        auto reverse=read(directory+"/fixture/reference-reverse.f32",count);
        auto view=[&](const std::vector<float>& data, uint64_t generation, int64_t index) {
            FrameView result{{}, {}, w,h};
            for(int c=0;c<3;++c) {result.planes[c]=data.data()+size_t(c)*w*h;result.strides[c]=w*sizeof(float);}
            result.identity={generation,index};return result;
        };
        EngineConfig config{directory,ComputePolicy::CPUAndNeuralEngine,w,h};
        config.pipeline=coarse?Pipeline::SplitCoarseMetal:(metal?Pipeline::SplitEncoderRefineMetal:Pipeline::SplitEncoderRefine);
        auto engine=RifeEngine::create(config);
        auto evaluate=[&](const FrameView& first,const FrameView& second,bool hit,const std::vector<float>& expected) {
            auto out=engine->interpolate(first,second,.5f);
            check(out.featureCacheHit==hit, "feature cache identity/generation mismatch");
            check(out.encoderPredictions==(hit?1:2), "encoder call count");
            parity(out,expected);return out;
        };
        evaluate(view(a,1,0),view(b,1,1),false,forward);
        evaluate(view(b,1,1),view(a,1,2),true,reverse);
        evaluate(view(a,2,0),view(b,2,1),false,forward); // seek: same indices, new generation
        evaluate(view(a,2,5),view(b,2,6),false,forward); // nonadjacent request
        engine->reset();
        evaluate(view(b,2,6),view(a,2,7),false,reverse);
        // Invalid new input must discard cached features and release the call guard.
        b[0]=std::numeric_limits<float>::quiet_NaN();
        bool rejected=false;
        try {engine->interpolate(view(a,2,7),view(b,2,8),.5f);}
        catch(const EngineError& e) {rejected=e.code()==ErrorCode::NonFinite;}
        check(rejected,"non-finite input rejection");b[0]=read(directory+"/fixture/frame1.f32",count)[0];
        evaluate(view(a,2,7),view(b,2,8),false,forward);
        evaluate(view(a,0,-1),view(b,0,-1),false,forward);
        evaluate(view(a,0,-1),view(b,0,-1),false,forward); // callers without IDs never reuse
        if(benchmark) {
            engine->reset();std::vector<double> times;
            for(int i=0;i<150;++i) {
                auto out=engine->interpolate(view(i%2?b:a,3,i),view(i%2?a:b,3,i+1),.5f);
                check(out.featureCacheHit==(i!=0),"benchmark cache reuse");
                if(i>=30)times.push_back(out.inferenceMs);
                if(i==149)parity(out,reverse);
            }
            std::sort(times.begin(),times.end());
            std::cout<<"Split engine with all input/output copies: p50="<<times[59]<<" ms, p95="<<times[113]<<" ms\n";
            check(times[113]<=26.7,"1080p engine performance budget");
        }
        std::cout<<"Split engine: reference, reuse, seek, gap, reset and error recovery passed\n";
        return 0;
    } catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;}
}

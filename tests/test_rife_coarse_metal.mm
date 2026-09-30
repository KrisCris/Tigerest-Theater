#include "RifeCoarseMetal.h"
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

static void check(bool ok,const char* message) {if(!ok)throw std::runtime_error(message);}
static std::vector<float> read(const std::string& path,size_t count) {
    std::vector<float> values(count);std::ifstream file(path,std::ios::binary);
    file.read(reinterpret_cast<char*>(values.data()),count*sizeof(float));
    check(file.good() && file.peek()==EOF,"fixture size");return values;
}
static MLMultiArray* input(const std::string& path,int channels) {
    MLMultiArray* a=[[MLMultiArray alloc] initWithShape:@[@1,@(channels),@128,@128]
        dataType:MLMultiArrayDataTypeFloat32 error:nil];
    auto values=read(path,channels*128*128);memcpy(a.dataPointer,values.data(),values.size()*4);return a;
}
static void parity(MLMultiArray* actual,const std::string& path,double maxError,double meanError) {
    auto expected=read(path,actual.count);double sum=0,maximum=0;
    for(size_t i=0;i<expected.size();++i) {
        double value=actual.dataType==MLMultiArrayDataTypeFloat32 ? static_cast<float*>(actual.dataPointer)[i]
            : static_cast<_Float16*>(actual.dataPointer)[i];
        check(std::isfinite(value),"finite output");
        double error=std::abs(value-expected[i]);sum+=error;maximum=std::max(maximum,error);
    }
    std::cout<<path<<" max="<<maximum<<" mean="<<sum/expected.size()<<'\n';
    check(maximum<=maxError && sum/expected.size()<=meanError,"Metal coarse reference disagreement");
}
int main(int argc,char** argv) {
    @autoreleasepool {try {
        check(argc==2,"usage: test_rife_coarse_metal <fixtures>");
        auto coarse=rife::CoarseMetal::create(128,128);
        for(int c=0;c<3;++c) {
            std::string dir=std::string(argv[1])+"/"+std::to_string(c)+"/";
            coarse->begin(input(dir+"low0.f32",3),input(dir+"low1.f32",3),
                          input(dir+"features0.f32",4),input(dir+"features1.f32",4));
            for(int i=0;i<4;++i) {
                parity(coarse->pack(i),dir+"packed"+std::to_string(i)+".f32",.01,.0001);
                MLMultiArray* raw=coarse->options(i).outputBackings[@"block_output"];
                auto data=read(dir+"raw"+std::to_string(i)+".f32",raw.count);
                memcpy(raw.dataPointer,data.data(),data.size()*4);
                coarse->accept(i,raw);
            }
            parity(coarse->pack(4),dir+"packed4.f32",.04,.0002);
            parity(coarse->flow(),dir+"flow.f32",.001,.0001);
        }
        std::cout<<"Fused coarse Metal: three independent PyTorch intermediate fixtures passed\n";
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
}

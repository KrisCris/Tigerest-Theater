#pragma once
#include <cstdint>
#include <string>
namespace rife {
struct Metrics {
    uint64_t epoch=0,predictions=0,pairs=0,cuts=0;
    double p95Ms=0;
    std::string error;
};
// A single process-local registry lives in the shared engine dylib. Controller
// and VS plugin link the same library; no files, sockets or Python IPC needed.
uint64_t openSession();
void closeSession(uint64_t session);
uint64_t beginInstance(uint64_t session);
void recordFrame(uint64_t session,uint64_t epoch,int index,bool synthesized,double ms,const std::string& reason);
Metrics readMetrics(uint64_t session);
}

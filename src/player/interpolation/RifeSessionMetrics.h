#pragma once
#include <cstdint>
#include <string>
#if defined(_WIN32)
#if defined(TIGEREST_RIFE_BUILD)
#define RIFE_API __declspec(dllexport)
#else
#define RIFE_API __declspec(dllimport)
#endif
#else
#define RIFE_API
#endif
namespace rife {
struct Metrics {
    uint64_t epoch=0,predictions=0,pairs=0,cuts=0;
    double p95Ms=0;
    bool timingAvailable=true;
    std::string error;
};
// A single process-local registry lives in the shared library. Controller
// and VS plugin link the same library; no files, sockets or Python IPC needed.
RIFE_API uint64_t openSession();
RIFE_API void closeSession(uint64_t session);
RIFE_API uint64_t beginInstance(uint64_t session);
RIFE_API void recordFrame(uint64_t session,uint64_t epoch,int index,bool synthesized,double ms,
                          const std::string& reason,int factor=2,bool timingAvailable=true);
RIFE_API Metrics readMetrics(uint64_t session);
}

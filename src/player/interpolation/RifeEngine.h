#pragma once
#include "RifeTypes.h"
#include <memory>

namespace rife {
// A session owns one engine. Calls must be serialized by the owner; overlapping
// calls fail immediately instead of racing Core ML's reused tensor buffers.
class RifeEngine final {
public:
    static std::unique_ptr<RifeEngine> create(const EngineConfig& config);
    ~RifeEngine();
    RifeEngine(const RifeEngine&) = delete;
    RifeEngine& operator=(const RifeEngine&) = delete;
    FrameBuffer interpolate(const FrameView& a, const FrameView& b, float timestep);
    void reset(); // Discard frame identities/features; serialized like interpolate.
private:
    struct Impl;
    explicit RifeEngine(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> m_impl;
};
} // namespace rife

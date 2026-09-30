#include "FrameTiming.h"
#include <cmath>
#include <limits>
#include <numeric>

namespace rife {
std::pair<Rational,Rational> splitDuration(int64_t num, int64_t den) {
    if (num <= 0 || den <= 0) throw std::invalid_argument("Invalid frame duration");
    const auto common = std::gcd(num,den);
    num /= common; den /= common;
    if (num % 2 == 0) num /= 2;
    else {
        if (den > std::numeric_limits<int64_t>::max()/2) throw std::overflow_error("Frame duration overflow");
        den *= 2;
    }
    return {{num,den},{num,den}};
}
std::pair<int,int> sourceFramesForOutput(int output, int sourceCount) {
    if (output < 0 || sourceCount <= 0 || int64_t(output) >= int64_t(sourceCount)*2)
        throw std::invalid_argument("Output frame outside clip");
    const int first = output/2;
    return {first, output%2 ? std::min(first+1,sourceCount-1) : first};
}
bool isExpectedDuration(int64_t num, int64_t den, Rational fps) {
    if (num <= 0 || den <= 0 || fps.num <= 0 || fps.den <= 0) return false;
    const double duration = double(num)/den, expected = double(fps.den)/fps.num;
    // Container PTS can be quantized to milliseconds; mpv exports the resulting
    // duration in microseconds. A separate window catches sustained drift.
    return std::abs(duration-expected) <= 1.1e-3;
}

void CfrTimingTracker::reset() {m_last=-1;m_error=0;m_count=0;m_accepted=true;}
bool CfrTimingTracker::accept(int64_t frame,Rational duration) {
    if(frame<0)return false;
    if(frame==m_last)return m_accepted;
    if(m_last==std::numeric_limits<int64_t>::max() || frame!=m_last+1)reset();
    m_last=frame;
    m_accepted=isExpectedDuration(duration.num,duration.den,m_fps);
    if(!m_accepted)return false;
    m_error+=static_cast<long double>(duration.num)/duration.den-
             static_cast<long double>(m_fps.den)/m_fps.num;
    ++m_count;
    // Bound both container timestamp rounding and exported microsecond rounding.
    // Use short windows so rounding tolerance cannot grow without limit.
    m_accepted=std::abs(m_error)<=1.1e-3L+m_count*1e-6L;
    if(m_count==120) {m_count=0;m_error=0;}
    return m_accepted;
}
} // namespace rife

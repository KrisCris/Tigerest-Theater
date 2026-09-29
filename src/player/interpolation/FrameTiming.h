#pragma once
#include <cstdint>
#include <utility>
#include <stdexcept>
#include <algorithm>

namespace rife {
struct Rational {
    int64_t num, den;
    bool operator==(const Rational& other) const { return num == other.num && den == other.den; }
};
std::pair<Rational,Rational> splitDuration(int64_t num, int64_t den);
std::pair<int,int> sourceFramesForOutput(int output, int sourceCount);
bool isExpectedDuration(int64_t num, int64_t den, Rational fps);
class CfrTimingTracker {
public:
    explicit CfrTimingTracker(Rational fps) : m_fps(fps) {}
    bool accept(int64_t frame, Rational duration);
    void reset();
private:
    Rational m_fps;
    int64_t m_last = -1;
    long double m_error = 0;
    int m_count = 0;
    bool m_accepted = true;
};
} // namespace rife

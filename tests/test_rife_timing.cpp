#include "FrameTiming.h"
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>

using namespace rife;
int main() {
    for (auto fps : {Rational{24000,1001}, Rational{30000,1001}, Rational{24,1}, Rational{25,1}, Rational{30,1}}) {
        auto d = splitDuration(fps.den, fps.num);
        assert(d.first == d.second);
        assert(d.first.num * 2 * fps.num == fps.den * d.first.den);
        for (int count : {1, 2, 5, 1001}) {
            int64_t total = 0;
            for (int out = 0; out < count*2; ++out) {
                auto pair = sourceFramesForOutput(out, count);
                assert(pair.first >= 0 && pair.second < count);
                assert(pair.first == out/2);
                assert(pair.second == (out%2 ? std::min(out/2+1,count-1) : out/2));
                total += d.first.num;
            }
            assert(total * fps.num == int64_t(count) * fps.den * d.first.den);
        }
    }
    bool failed=false;
    try { splitDuration(1,0); } catch (const std::invalid_argument&) { failed=true; }
    assert(failed);
    // Reduce before multiplying: this would overflow a naive denominator*2.
    auto d=splitDuration(2,std::numeric_limits<int64_t>::max());
    assert(d.first == (Rational{1,std::numeric_limits<int64_t>::max()}));
    failed=false;
    try { splitDuration(1,std::numeric_limits<int64_t>::max()); } catch (const std::overflow_error&) { failed=true; }
    assert(failed);
    assert(isExpectedDuration(41708,1000000,{24000,1001}));
    assert(!isExpectedDuration(1,30,{24000,1001}));
    assert(!isExpectedDuration(0,1,{24,1}));
    // Matroska commonly quantizes CFR timestamps to milliseconds. Preserve
    // that input's eligibility while rejecting sustained timing drift.
    CfrTimingTracker tracker({24000,1001});
    for(int n=0;n<18000;++n) {
        auto start=std::llround(n*1000.*1001/24000);
        auto end=std::llround((n+1)*1000.*1001/24000);
        assert(tracker.accept(n,{end-start,1000}));
        assert(tracker.accept(n,{end-start,1000})); // lookahead/even-frame duplicate
    }
    tracker.reset();
    assert(tracker.accept(0,{41,1000}));
    assert(!tracker.accept(1,{41,1000})); // plausible single frame, wrong sustained rate
    tracker.reset();
    for(int n=0;n<18000;++n)assert(tracker.accept(n,{41708,1000000}));
    assert(tracker.accept(5,{1001,24000})); // discontinuous frame index starts a new window
    std::cout << "FrameTiming: fractional rates, EOF and duration checks passed\n";
}

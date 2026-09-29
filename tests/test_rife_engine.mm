#include "RifeEngine.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <limits>
#include <vector>

using namespace rife;
static void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
static std::vector<float> read(const std::string& path, size_t count) {
    std::vector<float> data(count);
    std::ifstream file(path, std::ios::binary);
    file.read(reinterpret_cast<char*>(data.data()), data.size() * sizeof(float));
    check(file.good() && file.peek() == EOF, "fixture length");
    return data;
}
template<class F> static void rejects(F f, ErrorCode expected) {
    try { f(); } catch (const EngineError& error) {
        check(error.code() == expected, "wrong error category"); return;
    }
    throw std::runtime_error("expected rejection");
}
static void exercise(const std::string& directory, int width, int height, bool benchmark = false) {
    const size_t count = size_t(width) * height * 3;
    auto a = read(directory + "/fixture/frame0.f32", count);
    auto b = read(directory + "/fixture/frame1.f32", count);
    auto reference = read(directory + "/fixture/reference.f32", count);
    // Exercise real row padding: the plugin's VS strides need not equal width.
    const size_t stride = width + 16, plane = stride * height;
    std::vector<float> padded(plane * 3, -99);
    FrameView av{{}, {}, width, height}, bv{{}, {}, width, height};
    for (int c = 0; c < 3; ++c) {
        av.planes[c] = padded.data() + c * plane;
        av.strides[c] = stride * sizeof(float);
        bv.planes[c] = b.data() + size_t(c) * width * height;
        bv.strides[c] = width * sizeof(float);
        for (int y = 0; y < height; ++y)
            std::copy_n(a.data() + (size_t(c) * height + y) * width, width,
                        padded.data() + c * plane + y * stride);
    }
    auto engine = RifeEngine::create({directory, ComputePolicy::CPUAndGPU, width, height});
    std::vector<double> times;
    for (int i = 0; i < (benchmark ? 150 : 3); ++i) {
        auto frame = engine->interpolate(av, bv, .5f);
        if (benchmark && i >= 30) times.push_back(frame.inferenceMs);
        check(frame.width == width && frame.height == height, "output shape");
        check(frame.pixels.size() == count && frame.inferenceMs > 0, "output buffer/statistics");
        double mae = 0, mse = 0;
        size_t non8bit = 0;
        for (size_t n = 0; n < count; ++n) {
            float v = frame.pixels[n];
            check(std::isfinite(v), "finite output");
            double d = v - reference[n]; mae += std::abs(d); mse += d*d;
            non8bit += std::abs(v*255 - std::round(v*255)) > .01;
        }
        check(mae/count <= .005 && mse/count <= .0001, "reference parity");
        check(non8bit > count/2, "output must preserve float detail");
    }
    if (benchmark) {
        std::sort(times.begin(), times.end());
        std::cout << "Engine including input checks/copies/output: p50=" << times[59]
                  << " ms, p95=" << times[113] << " ms\n";
        check(times[113] <= 26.7, "engine p95 exceeds 1080p budget");
    }
    FrameView wrong = av; wrong.width -= 1;
    rejects([&] { engine->interpolate(wrong, bv, .5f); }, ErrorCode::InvalidFrame);
    wrong = av; wrong.planes[1] = nullptr;
    rejects([&] { engine->interpolate(wrong, bv, .5f); }, ErrorCode::InvalidFrame);
    wrong = av; wrong.strides[2] = 1;
    rejects([&] { engine->interpolate(wrong, bv, .5f); }, ErrorCode::InvalidFrame);
    rejects([&] { engine->interpolate(av, bv, .25f); }, ErrorCode::InvalidFrame);
    padded[0] = std::numeric_limits<float>::quiet_NaN();
    rejects([&] { engine->interpolate(av, bv, .5f); }, ErrorCode::NonFinite);
    padded[0] = a[0];
    engine->interpolate(av, bv, .5f); // failure must release the call guard
    rejects([&] { RifeEngine::create({directory, ComputePolicy::CPUAndGPU, width+1, height}); }, ErrorCode::InvalidConfiguration);
}
int main(int argc, char** argv) {
    try {
        check(argc == 3 || argc == 4, "usage: test_rife_engine <1080p-model-dir> <128-model-dir> [--benchmark]");
        rejects([] { RifeEngine::create({"/no/such/rife-model", ComputePolicy::CPUAndGPU, 128, 128}); }, ErrorCode::ModelLoad);
        exercise(argv[1], 1920, 1080, argc == 4);
        exercise(argv[2], 128, 128); // release and reload a different shape
        exercise(argv[1], 1920, 1080); // no stale shape/cache after returning
        std::cout << "RifeEngine: all reference, stride, reload, error and precision checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}

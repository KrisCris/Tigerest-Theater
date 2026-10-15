#include "native_rife_fixture.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern const struct mp_user_filter_entry vf_tigerest_rife;
static unsigned failures, cases;
static void failed(const char *function, int line, const char *message) {
    failures++;
    if (failures <= 30) fprintf(stderr, "FAIL %s:%d: %s\n", function, line, message);
    if (failures == 31) fprintf(stderr, "Further assertion details suppressed; final count includes them.\n");
}
#define CHECK(condition, message) do { if (!(condition)) failed(__func__, __LINE__, (message)); } while (0)
static bool close_to(double a, double b) { return fabs(a - b) < 1e-9; }
static struct mp_filter *start(void) { fx_begin(); return vf_tigerest_rife.create(NULL, NULL); }
static void finish(struct mp_filter *filter) {
    fx_destroy_filter(filter);
    CHECK(fx.allocations == 0 && fx.images == 0 && fx.pixels == 0, "all fixture-owned allocations and image references released");
    CHECK(fx.creates == fx.destroys, "every retained engine destroyed exactly once");
}
static void input(struct mp_filter *filter, double pts, double fps, float pixel) {
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, fx_image(pts, fps, pixel, false)));
}
static void output_duration(struct mp_filter *filter, double pts, double fps, float pixel, double duration) {
    struct mp_frame frame = fx_pull(filter);
    CHECK(frame.type == MP_FRAME_VIDEO, "a video output is available");
    if (frame.type == MP_FRAME_VIDEO) {
        struct mp_image *image = frame.data;
        CHECK(close_to(image->pts, pts), "output PTS follows the expected source/midpoint sequence");
        CHECK(close_to(image->nominal_fps, fps), "output metadata describes the selected cadence");
        CHECK(close_to(image->pkt_duration, duration), "output packet duration matches the delivered cadence");
        CHECK(close_to(*(float *)image->planes[0], pixel), "output uses the expected original or adjacent-frame pair");
    }
    fx_release(frame);
}
static void output(struct mp_filter *filter, double pts, double fps, float pixel) {
    output_duration(filter, pts, fps, pixel, 1/fps);
}
static void none(struct mp_filter *filter) {
    struct mp_frame frame = fx_pull(filter);
    CHECK(frame.type == MP_FRAME_NONE, "no extra output is fabricated"); fx_release(frame);
}
static long long metric(struct mp_filter *filter, const char *name) {
    struct mp_tags *tags = NULL;
    struct mp_filter_command command = {.type = MP_FILTER_COMMAND_GET_META, .res = &tags};
    CHECK(filter->info->command(filter, &command), "metadata query succeeds");
    CHECK(tags != NULL, "metadata query returns a map");
    long long result = tags ? atoll(fx_tag(tags, name)) : -1;
    talloc_free(tags); return result;
}
static void speed_metadata(struct mp_filter *filter, double speed, const char *status) {
    struct mp_tags *tags = NULL;
    struct mp_filter_command command = {.type = MP_FILTER_COMMAND_GET_META, .res = &tags};
    CHECK(filter->info->command(filter, &command) && tags, "speed diagnostics are available");
    if (tags) {
        CHECK(close_to(atof(fx_tag(tags, "playbackSpeed")), speed), "metadata reports the selected speed without changing it");
        if (status) CHECK(!strcmp(fx_tag(tags, "status"), status), "metadata reports the current processing mode");
    }
    CHECK(close_to(fx_global.opts.playback_speed, speed), "filter never modifies the selected playback speed");
    talloc_free(tags);
}

// The recovery path must preserve hardware frames at source cadence and do no
// expensive work; a missing/shortened cooldown or accidental interpolation fails.
static void recovery_frames(struct mp_filter *filter, double first_pts, double fps,
                            float first_pixel, int count) {
    int conversions = fx.conversions, downloads = fx.downloads;
    int interpolations = fx.interpolations, creates = fx.creates;
    for (int i = 0; i < count; i++) {
        struct mp_image *original = fx_image(first_pts+i/fps, fps, first_pixel+2*i, true);
        fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, original));
        struct mp_frame frame = fx_pull(filter);
        CHECK(frame.type == MP_FRAME_VIDEO && frame.data == original,
              "recovery returns each original hardware input without conversion");
        if (frame.type == MP_FRAME_VIDEO) {
            struct mp_image *img = frame.data;
            CHECK(close_to(img->pts, first_pts+i/fps) && close_to(img->nominal_fps, fps) &&
                  close_to(img->pkt_duration, 1/fps), "recovery preserves source PTS and cadence");
        }
        fx_release(frame); none(filter);
        speed_metadata(filter, fx_global.opts.playback_speed, "speed-recovery");
        CHECK(fx.conversions == conversions && fx.downloads == downloads &&
              fx.interpolations == interpolations && fx.creates == creates,
              "recovery performs no download, conversion, model initialization or inference");
    }
}

// Catches midpoint PTS/order errors, mutation of the saved source's FPS,
// and using output-frame indices instead of source-frame cache identities.
static void cfr_and_metadata(void) {
    struct mp_filter *filter = start();
    struct mp_image *first = fx_image(0, 24, 0, false);
    struct mp_image *retained = mp_image_new_ref(first);
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, first)); output(filter, 0, 48, 0); none(filter);
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/48, 48, 1); output(filter, 1.0/24, 48, 2);
    input(filter, 1.0/12, 24, 4); output(filter, 1.0/16, 48, 3); output(filter, 1.0/12, 48, 4);
    CHECK(retained->nominal_fps == 24 && retained->pkt_duration == 1.0/24, "input metadata stays independent of output references");
    CHECK(fx.interpolations == 2 && fx.last_index == 3, "consecutive source frames preserve adjacency for the feature cache");
    CHECK(metric(filter, "inputs") == 3 && metric(filter, "outputs") == 5 && metric(filter, "generated") == 2, "reported counts agree with delivered frames");
    talloc_free(retained); finish(filter);
}

// Rounded 23.976 timestamps must interpolate using actual PTS, not a synthetic
// constant output clock which would drift away from the input stream.
static void rounded_cfr(void) {
    struct mp_filter *filter = start();
    double fps = 24000.0/1001;
    input(filter, 0, fps, 0); output(filter, 0, 2*fps, 0);
    input(filter, .042, fps, 2); output_duration(filter, .021, 2*fps, 1, .021); output(filter, .042, 2*fps, 2);
    input(filter, .083, fps, 4); output_duration(filter, .0625, 2*fps, 3, .0205); output(filter, .083, 2*fps, 4);
    CHECK(fx.interpolations == 2, "millisecond timestamp rounding does not reset every pair");
    finish(filter);
}

// A time jump must never synthesize between unrelated content; the next
// adjacent pair must restart cache identity without recreating the model.
static void discontinuity(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/48, 48, 1); output(filter, 1.0/24, 48, 2);
    uint64_t old_generation = fx.last_generation;
    input(filter, 2, 24, 20); output(filter, 2, 48, 20); none(filter);
    input(filter, 2+1.0/24, 24, 22); output(filter, 2+1.0/48, 48, 21); output(filter, 2+1.0/24, 48, 22);
    CHECK(fx.interpolations == 2 && fx.last_generation != old_generation && fx.last_index == 2, "discontinuity resets adjacency and feature-cache generation");
    CHECK(fx.creates == 1, "cache reset retains the loaded model"); finish(filter);
}

// Format and unsupported-source boundaries must also prevent cross-boundary
// interpolation, even when timestamps remain continuous.
static void source_boundaries(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    struct mp_image *changed = fx_image(1.0/24, 24, 2, false);
    changed->params.color.transfer = PL_COLOR_TRC_SRGB;
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, changed)); output(filter, 1.0/24, 48, 2); none(filter);
    struct mp_image *unsupported = fx_image(1.0/12, 24, 4, false);
    unsupported->w = unsupported->params.w = 1280; unsupported->h = unsupported->params.h = 720;
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, unsupported)); output(filter, 1.0/12, 24, 4); none(filter);
    input(filter, 1.0/8, 24, 6); output(filter, 1.0/8, 48, 6); none(filter);
    input(filter, 1.0/6, 24, 8); output(filter, 7.0/48, 48, 7); output(filter, 1.0/6, 48, 8);
    CHECK(fx.interpolations == 1 && fx.last_a == 6 && fx.last_b == 8, "only the final same-format supported pair is interpolated");
    CHECK(metric(filter, "bypassed") == 1, "unsupported input is counted and preserved"); finish(filter);
}

// Without downstream demand the filter must not consume input/download/build
// a model. Hardware image classification must use imgfmt, not backing layout.
static void backpressure_and_hardware(void) {
    struct mp_filter *filter = start();
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, fx_image(0, 24, 3, true)));
    for (int i = 0; i < 50; i++) filter->info->process(filter);
    CHECK(filter->ppins[0]->reads == 0 && fx.creates == 0 && fx.downloads == 0, "no work occurs without output demand");
    output(filter, 0, 48, 3);
    CHECK(fx.downloads == 1, "hardware input passes through the download boundary"); finish(filter);
}

// EOF may already be available while the original belonging to an emitted
// midpoint is pending. Reading EOF first would lose that original.
static void pending_before_eof(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/48, 48, 1);
    fx_push(filter, MAKE_FRAME(MP_FRAME_EOF, NULL));
    output(filter, 1.0/24, 48, 2);
    CHECK(filter->ppins[0]->reads == 2, "pending original drains before EOF is consumed");
    struct mp_frame eof = fx_pull(filter);
    CHECK(eof.type == MP_FRAME_EOF && filter->ppins[0]->reads == 3, "EOF follows the last original"); fx_release(eof); none(filter);
    CHECK(metric(filter, "outputs") == 3, "EOF is not counted as a video frame"); finish(filter);
}

// A seek intentionally flushes pending pre-seek output. New media must warm
// from a fresh pair without accidentally reusing the old encoder features.
static void seek_with_pending(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/48, 48, 1);
    uint64_t old_generation = fx.last_generation;
    fx_seek(filter); none(filter);
    input(filter, 10, 24, 10); output(filter, 10, 48, 10);
    input(filter, 10+1.0/24, 24, 12); output(filter, 10+1.0/48, 48, 11); output(filter, 10+1.0/24, 48, 12);
    CHECK(fx.last_generation != old_generation && fx.last_index == 2, "seek advances generation and restarts source identities");
    CHECK(fx.last_a == 10 && fx.last_b == 12 && fx.creates == 1, "new pair uses fresh content with the same model"); finish(filter);
}

// A nested new_ref in setrefp leaks a frame per input; retaining outputs when
// no longer needed produces growing live-image counts in this streaming test.
static void bounded_references(void) {
    struct mp_filter *filter = start();
    for (int i = 0; i < 6000; i++) {
        input(filter, i/24.0, 24, (float)i);
        if (i) output(filter, (i-.5)/24, 48, i-.5f);
        output(filter, i/24.0, 48, (float)i);
    }
    CHECK(metric(filter, "generated") == 5999 && metric(filter, "outputs") == 11999, "all streaming outputs delivered");
    CHECK(fx.peak_images <= 8 && fx.peak_pixels <= 4, "live image and buffer references stay bounded across 6000 inputs");
    finish(filter);
}

// Characterization only: one temporary inference failure currently latches
// pass-through for the rest of the filter instance, even after seek.
static void characterize_failure_latch(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    fx.fail_next_inference = true;
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/24, 24, 2);
    input(filter, 1.0/12, 24, 4); output(filter, 1.0/12, 24, 4); none(filter);
    fx_seek(filter);
    input(filter, 10, 24, 10); output(filter, 10, 24, 10);
    input(filter, 10+1.0/24, 24, 12); output(filter, 10+1.0/24, 24, 12); none(filter);
    CHECK(fx.interpolations == 1 && metric(filter, "failures") == 1, "transient failure remains latched across reset"); finish(filter);
}

// Bypass at 2x, preserving the pending original and restoring interpolation
// only with a new adjacent pair. Metadata polling must not flush that original.
static void speed_transition(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/48, 48, 1);
    uint64_t before = fx.last_generation;
    fx_global.opts.playback_speed = 2;
    speed_metadata(filter, 2, NULL);
    input(filter, 1.0/12, 24, 4);
    output(filter, 1.0/24, 48, 2);
    CHECK(filter->ppins[0]->reads == 2, "speed transition must drain the pending original before reading new source");
    output(filter, 1.0/12, 24, 4); none(filter);
    CHECK(fx.interpolations == 1 && fx.conversions == 2, "2x playback bypasses conversion and inference");
    speed_metadata(filter, 2, "speed-bypass");
    fx_global.opts.playback_speed = 1;
    recovery_frames(filter, 1.0/8, 24, 6, 9);
    input(filter, .5, 24, 24);
    output(filter, .5, 48, 24); none(filter);
    speed_metadata(filter, 1, "warming");
    input(filter, 13.0/24, 24, 26); output(filter, 25.0/48, 48, 25); output(filter, 13.0/24, 48, 26);
    CHECK(fx.last_generation != before && fx.last_index == 2, "returning to 1x restarts cache identity");
    CHECK(fx.interpolations == 2 && fx.last_a == 24 && fx.last_b == 26, "recovery interpolates only the new adjacent pair");
    speed_metadata(filter, 1, "active");
    CHECK(fx.creates == 1, "speed transition retains the loaded model"); finish(filter);
}

// Starting fast must avoid the expensive model/download path immediately;
// a later .5x rate remains eligible and initializes the model only then.
static void initial_speed_and_slow_recovery(void) {
    fx_begin(); fx_global.opts.playback_speed = 2;
    struct mp_filter *filter = vf_tigerest_rife.create(NULL, NULL);
    speed_metadata(filter, 2, NULL);
    fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, fx_image(0, 24, 0, true)));
    output(filter, 0, 24, 0);
    input(filter, 1.0/24, 24, 2);
    output(filter, 1.0/24, 24, 2); none(filter);
    CHECK(fx.interpolations == 0 && fx.creates == 0 && fx.downloads == 0 && fx.conversions == 0, "initial 2x bypasses the entire inference preparation path");
    speed_metadata(filter, 2, "speed-bypass");
    fx_global.opts.playback_speed = .5;
    recovery_frames(filter, 1.0/12, 24, 4, 9);
    input(filter, 11.0/24, 24, 22); output(filter, 11.0/24, 48, 22); none(filter);
    input(filter, .5, 24, 24); output(filter, 23.0/48, 48, 23); output(filter, .5, 48, 24);
    CHECK(fx.interpolations == 1 && fx.creates == 1 && fx.last_a == 22 && fx.last_b == 24, ".5x restoration warms and interpolates a new pair");
    speed_metadata(filter, .5, "active");
    finish(filter);
}

// All fast rates share one bypass mode: changing 1.25->2 does not repeatedly
// reset caches. A seek flushes state but leaves that mode and engine intact.
static void fast_rates_seek_and_eof(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    fx_global.opts.playback_speed = 1.25;
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/24, 24, 2); none(filter);
    speed_metadata(filter, 1.25, "speed-bypass");
    long long entered = metric(filter, "resets");
    fx_global.opts.playback_speed = 2;
    input(filter, 1.0/12, 24, 4); output(filter, 1.0/12, 24, 4); none(filter);
    CHECK(metric(filter, "resets") == entered, "switching between fast rates does not reset again");
    fx_seek(filter);
    input(filter, 10, 24, 10); output(filter, 10, 24, 10); none(filter);
    CHECK(metric(filter, "resets") == entered+1, "a seek in bypass causes just the seek reset");
    speed_metadata(filter, 2, "speed-bypass");
    fx_global.opts.playback_speed = 1;
    recovery_frames(filter, 10+1.0/24, 24, 12, 9);
    input(filter, 10+10.0/24, 24, 30); output(filter, 10+10.0/24, 48, 30); none(filter);
    input(filter, 10+11.0/24, 24, 32); output(filter, 10+21.0/48, 48, 31); output(filter, 10+11.0/24, 48, 32);
    CHECK(fx.interpolations == 1 && fx.last_a == 30 && fx.last_b == 32 && fx.creates == 1, "seek and speed recovery reuse the engine with fresh content");
    fx_global.opts.playback_speed = 1.25;
    input(filter, 10+.5, 24, 34); output(filter, 10+.5, 24, 34); none(filter);
    fx_push(filter, MAKE_FRAME(MP_FRAME_EOF, NULL));
    struct mp_frame eof = fx_pull(filter);
    CHECK(eof.type == MP_FRAME_EOF, "EOF propagates while speed-bypassed"); fx_release(eof); none(filter);
    CHECK(fx.conversions == 3 && fx.creates == 1, "bypass inputs were not converted and model remains attached until destruction");
    finish(filter);
}

// Repeated temporary-speed gestures must not create duplicate/stale outputs,
// reload models or accumulate references; returning inside the tolerance stays
// in normal interpolation mode instead of thrashing on tiny speed differences.
static void repeated_speed_transitions(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    for (int cycle = 0; cycle < 50; cycle++) {
        int i = cycle*14;
        input(filter, (i+1)/24.0, 24, i+1); output(filter, (i+.5)/24, 48, i+.5f);
        fx_global.opts.playback_speed = 2;
        input(filter, (i+2)/24.0, 24, i+2);
        output(filter, (i+1)/24.0, 48, i+1); output(filter, (i+2)/24.0, 24, i+2); none(filter);
        long long entered = metric(filter, "resets");
        input(filter, (i+3)/24.0, 24, i+3); output(filter, (i+3)/24.0, 24, i+3); none(filter);
        CHECK(metric(filter, "resets") == entered, "steady bypass does not reset per input");
        fx_global.opts.playback_speed = 1;
        recovery_frames(filter, (i+4)/24.0, 24, i+4, 9);
        input(filter, (i+13)/24.0, 24, i+13); output(filter, (i+13)/24.0, 48, i+13); none(filter);
        CHECK(metric(filter, "resets") == entered+1, "leaving bypass resets only once");
        fx_global.opts.playback_speed = 1.00005;
        input(filter, (i+14)/24.0, 24, i+14); output(filter, (i+13.5)/24, 48, i+13.5f); output(filter, (i+14)/24.0, 48, i+14);
        CHECK(metric(filter, "resets") == entered+1, "normal-speed tolerance avoids unnecessary resets");
        fx_global.opts.playback_speed = 1;
    }
    CHECK(fx.interpolations == 100 && fx.creates == 1 && metric(filter, "resets") == 100, "50 complete speed cycles preserve model and pair accounting");
    CHECK(fx.peak_images <= 8 && fx.peak_pixels <= 4, "repeated mode transitions keep references bounded");
    finish(filter);
}

// Literal frame budgets independently cover ceil(fps*.35) at the eligible
// boundaries. Polling/no-input cycles must not consume or renew that budget.
static void recovery_budget_and_idle(void) {
    const struct { double fps; int frames; } rows[] = {
        {23, 9}, {24000.0/1001, 9}, {24, 9}, {25, 9}, {29.97, 11}, {30.01, 11}
    };
    for (unsigned n = 0; n < sizeof(rows)/sizeof(rows[0]); n++) {
        struct mp_filter *filter = start(); double fps = rows[n].fps;
        fx_global.opts.playback_speed = 2;
        input(filter, 0, fps, 0); output(filter, 0, fps, 0);
        fx_global.opts.playback_speed = 1;
        recovery_frames(filter, 1/fps, fps, 2, 1);
        long long resets = metric(filter, "resets");
        for (int i = 0; i < 100; i++) { none(filter); speed_metadata(filter, 1, "speed-recovery"); }
        recovery_frames(filter, 2/fps, fps, 4, rows[n].frames-1);
        CHECK(metric(filter, "resets") == resets, "recovery does not reset or extend per input/poll");
        input(filter, (rows[n].frames+1)/fps, fps, 70);
        output(filter, (rows[n].frames+1)/fps, 2*fps, 70); none(filter);
        speed_metadata(filter, 1, "warming");
        input(filter, (rows[n].frames+2)/fps, fps, 72);
        output(filter, (rows[n].frames+1.5)/fps, 2*fps, 71);
        output(filter, (rows[n].frames+2)/fps, 2*fps, 72);
        CHECK(fx.creates == 1 && fx.interpolations == 1 && fx.last_a == 70 && fx.last_b == 72,
              "finite recovery resumes inference from a fresh pair, never a bypass frame");
        finish(filter);
    }
}

static void recovery_restarted_by_speed(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    fx_global.opts.playback_speed = 2;
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/24, 24, 2);
    fx_global.opts.playback_speed = 1;
    recovery_frames(filter, 2.0/24, 24, 4, 3);
    fx_global.opts.playback_speed = 1.25;
    input(filter, 5.0/24, 24, 10); output(filter, 5.0/24, 24, 10);
    speed_metadata(filter, 1.25, "speed-bypass");
    fx_global.opts.playback_speed = .5;
    recovery_frames(filter, 6.0/24, 24, 12, 4);
    fx_global.opts.playback_speed = 1.00005;
    recovery_frames(filter, 10.0/24, 24, 20, 5);
    input(filter, 15.0/24, 24, 30); output(filter, 15.0/24, 48, 30); none(filter);
    input(filter, 16.0/24, 24, 32); output(filter, 31.0/48, 48, 31); output(filter, 16.0/24, 48, 32);
    CHECK(fx.creates == 1 && fx.interpolations == 1 && fx.last_a == 30 && fx.last_b == 32,
          "a second speed gesture restarts one full recovery budget without loading another model");
    CHECK(metric(filter, "resets") == 4, "only the four processing-mode transitions reset cache state");
    finish(filter);
}

// Seek/EOF/unsupported boundaries cancel recovery instead of carrying it into
// a new timeline. The next eligible normal-speed input starts a fresh pair.
static void recovery_lifecycle_boundaries(void) {
    for (int boundary = 0; boundary < 3; boundary++) {
        struct mp_filter *filter = start();
        input(filter, 0, 24, 0); output(filter, 0, 48, 0);
        fx_global.opts.playback_speed = 2;
        input(filter, 1.0/24, 24, 2); output(filter, 1.0/24, 24, 2);
        fx_global.opts.playback_speed = 1;
        recovery_frames(filter, 2.0/24, 24, 4, 2);
        if (boundary == 0) {
            fx_seek(filter); none(filter);
        } else if (boundary == 1) {
            fx_push(filter, MAKE_FRAME(MP_FRAME_EOF, NULL));
            struct mp_frame eof = fx_pull(filter);
            CHECK(eof.type == MP_FRAME_EOF, "EOF propagates during recovery without extra originals");
            fx_release(eof); none(filter);
        } else {
            struct mp_image *unsupported = fx_image(4.0/24, 24, 8, true);
            unsupported->w = unsupported->params.w = 1280;
            unsupported->h = unsupported->params.h = 720;
            fx_push(filter, MAKE_FRAME(MP_FRAME_VIDEO, unsupported));
            output(filter, 4.0/24, 24, 8); none(filter);
            speed_metadata(filter, 1, "unsupported-source");
        }
        input(filter, 10, 24, 40); output(filter, 10, 48, 40); none(filter);
        speed_metadata(filter, 1, "warming");
        input(filter, 10+1.0/24, 24, 42);
        output(filter, 10+1.0/48, 48, 41); output(filter, 10+1.0/24, 48, 42);
        CHECK(fx.creates == 1 && fx.interpolations == 1 && fx.last_a == 40 && fx.last_b == 42,
              "timeline boundary clears cooldown and reuses the model with new source history");
        finish(filter);
    }
}

static void recovery_does_not_clear_failure(void) {
    struct mp_filter *filter = start();
    input(filter, 0, 24, 0); output(filter, 0, 48, 0);
    fx.fail_next_inference = true;
    input(filter, 1.0/24, 24, 2); output(filter, 1.0/24, 24, 2);
    fx_global.opts.playback_speed = 2;
    input(filter, 2.0/24, 24, 4); output(filter, 2.0/24, 24, 4);
    fx_global.opts.playback_speed = 1;
    for (int i = 3; i < 20; i++) {
        input(filter, i/24.0, 24, i); output(filter, i/24.0, 24, i); none(filter);
        speed_metadata(filter, 1, "inference-failed");
    }
    CHECK(fx.interpolations == 1 && metric(filter, "failures") == 1,
          "speed recovery never revives an existing inference failure");
    finish(filter);
}

static void run(const char *name, void (*test)(void)) {
    unsigned before = failures; test(); cases++;
    printf("%s %s\n", failures == before ? "PASS" : "FAIL", name);
}
int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    run("CFR PTS and independent metadata", cfr_and_metadata);
    run("rounded 23.976 PTS", rounded_cfr);
    run("timestamp discontinuity", discontinuity);
    run("format and unsupported-source boundaries", source_boundaries);
    run("backpressure and hardware download", backpressure_and_hardware);
    run("pending original before EOF", pending_before_eof);
    run("seek with pending original", seek_with_pending);
    run("bounded ownership across 6000 inputs", bounded_references);
    run("current transient-failure latch", characterize_failure_latch);
    run("speed bypass/pending drain/recovery", speed_transition);
    run("initial 2x and .5x recovery", initial_speed_and_slow_recovery);
    run("1.25x, seek while bypassed and EOF", fast_rates_seek_and_eof);
    run("50 repeated speed transitions", repeated_speed_transitions);
    run("recovery frame budgets and idle polling", recovery_budget_and_idle);
    run("recovery restarted by another speed gesture", recovery_restarted_by_speed);
    run("recovery seek/EOF/unsupported boundaries", recovery_lifecycle_boundaries);
    run("recovery preserves the failure latch", recovery_does_not_clear_failure);
    printf("%u cases, %u failed assertions; fixture scheduling/ownership only\n", cases, failures);
    return failures ? 1 : 0;
}

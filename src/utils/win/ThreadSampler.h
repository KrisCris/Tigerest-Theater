#pragma once

class QQuickWindow;

// Diagnostic only: TIGEREST_THREAD_SAMPLES=<file> samples the GUI thread and
// the in-process Chromium/Qt frame threads every millisecond and writes one
// line per sample (wall-clock ms, thread name, module+offset frames).
// TIGEREST_FRAME_TIMES=<file> writes the wall-clock ms of every frame the
// window swapped, without the logging path that verbose frame logs take.
namespace ThreadSampler
{
void startFromEnvironment();
void recordFramesFromEnvironment(QQuickWindow *window);
}

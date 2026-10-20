#ifndef MAINTHREADWATCHDOG_H
#define MAINTHREADWATCHDOG_H

#include <QObject>
#include <QList>
#include <QString>
#include <QStringList>
#include <QTimer>
#include <QVariantMap>

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <thread>

// Detects a GUI thread that stops processing events (Windows shows the window as
// "not responding") and records where every thread is while it is stuck. A
// second thread checks a heartbeat that the watched thread updates from a timer.
// While stalled it samples thread stacks as module+offset text, which is written
// to the log and to a fault file. The file survives a forced exit so the next
// launch can still report the stall.
class MainThreadWatchdog : public QObject
{
  Q_OBJECT
public:
  struct Options
  {
    int beatMs = 250;
    int pollMs = 500;
    int stallMs = 5000;
    // Stall ages at which stacks are sampled. The first sample covers all threads.
    QList<int> sampleAtMs{5000, 10000, 20000, 40000};
  };

  explicit MainThreadWatchdog(QObject* parent = nullptr);
  ~MainThreadWatchdog() override;

  static bool supported();
  // Watches the calling thread. Returns false where stack sampling is unsupported.
  bool start(const QString& faultFile, const Options& options);
  bool start(const QString& faultFile) { return start(faultFile, Options()); }
  void stop();
  bool running() const { return m_thread.joinable(); }

  // Reads and removes the fault file left by a process that never recovered.
  static QVariantMap takeUnfinishedFault(const QString& faultFile);
  // One text record per thread, watched thread first. Never call it from the
  // watched thread: the calling thread is skipped.
  static QStringList captureStacks(quint32 mainThreadId, bool allThreads);

Q_SIGNALS:
  void stallRecovered(const QVariantMap& fault);

private:
  void run();
  void beat();

  Options m_options;
  QString m_faultFile;
  QTimer m_heartbeat;
  quint32 m_mainThreadId = 0;
  std::atomic<qint64> m_lastBeat{0};
  std::thread m_thread;
  std::mutex m_mutex;
  std::condition_variable m_wake;
  bool m_stopping = false;
};

#endif

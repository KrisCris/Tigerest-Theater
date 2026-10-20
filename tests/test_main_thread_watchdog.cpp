#include <QtTest/QtTest>
#include <QFile>
#include <QMutex>
#include <QSignalSpy>
#include <QTemporaryDir>

#include <atomic>
#include <thread>

#include "system/MainThreadWatchdog.h"
#include "utils/ReportDiagnostics.h"

#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace
{
QMutex messagesMutex;
QStringList criticalMessages;

void collectMessages(QtMsgType type, const QMessageLogContext&, const QString& message)
{
  if (type != QtCriticalMsg && type != QtWarningMsg)
    return;
  QMutexLocker lock(&messagesMutex);
  criticalMessages << message;
}

// A named frame of this executable must appear in the sampled main stack.
Q_NEVER_INLINE void holdMainThread(int ms)
{
#ifdef Q_OS_WIN
  Sleep(DWORD(ms));
#else
  QThread::msleep(ms);
#endif
}

// Reads without blocking the watchdog's replace and delete of the file.
QByteArray readShared(const QString& path)
{
  QByteArray bytes;
#ifdef Q_OS_WIN
  const HANDLE file = CreateFileW(reinterpret_cast<const wchar_t*>(path.utf16()), GENERIC_READ,
                                  FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
                                  OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE)
    return bytes;
  char buffer[65536];
  DWORD read = 0;
  while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read)
    bytes.append(buffer, int(read));
  CloseHandle(file);
#else
  QFile file(path);
  if (file.open(QIODevice::ReadOnly))
    bytes = file.readAll();
#endif
  return bytes;
}

MainThreadWatchdog::Options fastOptions()
{
  MainThreadWatchdog::Options options;
  options.beatMs = 50;
  options.pollMs = 50;
  options.stallMs = 400;
  options.sampleAtMs = {400, 800};
  return options;
}
}

class TestMainThreadWatchdog : public QObject
{
  Q_OBJECT
private slots:
  void init()
  {
    if (!MainThreadWatchdog::supported())
      QSKIP("Stack sampling is implemented for Windows x64 only");
    QMutexLocker lock(&messagesMutex);
    criticalMessages.clear();
  }

  void responsiveThreadIsNotReported()
  {
    QTemporaryDir dir;
    MainThreadWatchdog watchdog;
    QSignalSpy recovered(&watchdog, &MainThreadWatchdog::stallRecovered);
    QVERIFY(watchdog.start(dir.filePath("stall.json"), fastOptions()));
    QTest::qWait(1200);
    watchdog.stop();
    QCOMPARE(recovered.count(), 0);
    QVERIFY(!QFile::exists(dir.filePath("stall.json")));
  }

  void stallIsSampledLoggedAndRecovered()
  {
    QTemporaryDir dir;
    const QString faultFile = dir.filePath("stall.json");
    MainThreadWatchdog watchdog;
    QSignalSpy recovered(&watchdog, &MainThreadWatchdog::stallRecovered);
    QVERIFY(watchdog.start(faultFile, fastOptions()));
    QTest::qWait(200);

    // While the main thread is held, a forced exit must leave a readable fault.
    std::atomic<bool> stop{false};
    QByteArray faultWhileStalled;
    std::thread probe([&] {
      while (!stop)
      {
        const auto bytes = readShared(faultFile);
        if (bytes.contains("-- sample 2"))
        {
          faultWhileStalled = bytes;
          return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
      }
    });
    qInstallMessageHandler(collectMessages);
    holdMainThread(1500);
    QVERIFY(recovered.wait(3000));
    stop = true;
    probe.join();
    qInstallMessageHandler(nullptr);
    watchdog.stop();

    const auto fault = recovered.first().first().toMap();
    QCOMPARE(fault.value("kind").toString(), QStringLiteral("main-thread-stall"));
    QVERIFY2(fault.value("durationMs").toLongLong() >= 1000, qPrintable(fault.value("durationMs").toString()));
    QCOMPARE(fault.value("samples").toInt(), 2);
    QVERIFY(QDateTime::fromString(fault.value("startedAt").toString(), Qt::ISODateWithMs).isValid());
    QVERIFY2(!QFile::exists(faultFile), "a recovered stall is reported in-process");

    QStringList messages;
    {
      QMutexLocker lock(&messagesMutex);
      messages = criticalMessages;
    }
    const auto mainStack = std::find_if(messages.begin(), messages.end(), [](const QString& message) {
      return message.startsWith("Stall stack tid=") && message.contains(" [main]");
    });
    QVERIFY2(mainStack != messages.end(), qPrintable(messages.join("\n")));
    QVERIFY2(mainStack->contains("test_main_thread_watchdog.exe+0x"), qPrintable(*mainStack));
    QVERIFY2(mainStack->contains("ntdll.dll+0x"), qPrintable(*mainStack));
    QVERIFY2(!mainStack->contains(":\\") && !mainStack->contains(":/"), "no absolute module paths");
    // Records pass the report sanitizer unchanged, so the report keeps them.
    for (const auto& message : messages)
      if (message.startsWith("Stall stack tid="))
        QCOMPARE(ReportDiagnostics::sanitize(message), message);
    QVERIFY(std::any_of(messages.begin(), messages.end(), [](const QString& message) {
      return message.startsWith("Main thread unresponsive for") && message.contains("stack sample 1/2");
    }));
    QVERIFY(std::any_of(messages.begin(), messages.end(), [](const QString& message) {
      return message.startsWith("Main thread recovered after");
    }));
    // The first sample covers more than the watched thread.
    QVERIFY(std::count_if(messages.begin(), messages.end(), [](const QString& message) {
      return message.startsWith("Stall stack tid=");
    }) > 2);

    // The file written during the stall is what the next launch reports.
    QVERIFY2(!faultWhileStalled.isEmpty(), "fault file is written while stalled");
    QFile restore(faultFile);
    QVERIFY(restore.open(QIODevice::WriteOnly));
    restore.write(faultWhileStalled);
    restore.close();
    const auto unfinished = MainThreadWatchdog::takeUnfinishedFault(faultFile);
    QCOMPARE(unfinished.value("kind").toString(), QStringLiteral("main-thread-stall"));
    QVERIFY(unfinished.value("unrecovered").toBool());
    QVERIFY(unfinished.value("durationMs").toLongLong() >= 800);
    const auto stacks = unfinished.value("stacks").toStringList();
    QVERIFY(stacks.size() > 2);
    QVERIFY(stacks.first().contains(" [main]"));
    QVERIFY(!QFile::exists(faultFile));
    QVERIFY(MainThreadWatchdog::takeUnfinishedFault(faultFile).isEmpty());
  }

  void invalidFaultFileIsDiscarded()
  {
    QTemporaryDir dir;
    const QString faultFile = dir.filePath("stall.json");
    QFile file(faultFile);
    QVERIFY(file.open(QIODevice::WriteOnly));
    file.write("{\"version\":2,\"kind\":\"main-thread-stall\"}");
    file.close();
    QVERIFY(MainThreadWatchdog::takeUnfinishedFault(faultFile).isEmpty());
    QVERIFY(!QFile::exists(faultFile));
  }
};

QTEST_MAIN(TestMainThreadWatchdog)
#include "test_main_thread_watchdog.moc"

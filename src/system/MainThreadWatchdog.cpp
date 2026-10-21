#include "MainThreadWatchdog.h"

#include <QDateTime>
#include <QDebug>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

#include <algorithm>
#include <chrono>
#include <vector>

#include "core/Version.h"

#if defined(Q_OS_WIN) && defined(_M_X64)
#define TIGEREST_STALL_STACKS 1
#include <windows.h>
#include <psapi.h>
#include <tlhelp32.h>
#elif defined(Q_OS_MAC)
#include <sys/sysctl.h>
#include <unistd.h>
#endif

namespace
{
constexpr qint64 MaxFaultFileBytes = 4 * 1024 * 1024;

qint64 steadyMs()
{
  return std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
}

// A debugger stopping the process at a breakpoint is not a stall.
bool debuggerAttached()
{
#if defined(Q_OS_WIN) && defined(_M_X64)
  return IsDebuggerPresent();
#elif defined(Q_OS_MAC)
  int request[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  kinfo_proc info = {};
  size_t size = sizeof(info);
  return sysctl(request, 4, &info, &size, nullptr, 0) == 0 && (info.kp_proc.p_flag & P_TRACED);
#else
  return false;
#endif
}

#ifdef TIGEREST_STALL_STACKS
constexpr size_t StackCopyBytes = 1024 * 1024;
constexpr int MaxFrames = 48;
constexpr int MaxThreads = 256;

struct ThreadBasicInformation
{
  LONG exitStatus;
  PVOID tebBaseAddress;
  HANDLE uniqueProcess;
  HANDLE uniqueThread;
  ULONG_PTR affinityMask;
  LONG priority;
  LONG basePriority;
};
using NtQueryInformationThreadFn = LONG(NTAPI*)(HANDLE, int, PVOID, ULONG, PULONG);
using GetThreadDescriptionFn = HRESULT(WINAPI*)(HANDLE, PWSTR*);
using SetThreadDescriptionFn = HRESULT(WINAPI*)(HANDLE, PCWSTR);

struct Module
{
  quint64 base;
  quint64 end;
  QString name;
};

bool copyMemory(void* target, const void* source, size_t size)
{
  __try
  {
    memcpy(target, source, size);
    return true;
  }
  __except (EXCEPTION_EXECUTE_HANDLER)
  {
    return false;
  }
}

// Runs while the target is suspended. It may hold the heap, loader or logging
// lock, so nothing here allocates, logs or calls into the loader.
bool suspendAndCopy(HANDLE thread, quint64 stackBase, unsigned char* buffer, CONTEXT* context,
                    quint64* bottom, size_t* size)
{
  if (SuspendThread(thread) == DWORD(-1))
    return false;
  bool copied = false;
  context->ContextFlags = CONTEXT_FULL;
  if (GetThreadContext(thread, context) && context->Rsp && context->Rsp < stackBase)
  {
    *bottom = context->Rsp;
    *size = size_t(std::min<quint64>(stackBase - context->Rsp, StackCopyBytes));
    copied = copyMemory(buffer, reinterpret_cast<const void*>(context->Rsp), *size);
  }
  ResumeThread(thread);
  return copied;
}

void rebase(DWORD64& value, quint64 bottom, size_t size, quint64 copy)
{
  if (value >= bottom && value < bottom + size)
    value = value - bottom + copy;
}

// The thread runs again after the copy. Point saved frame pointers and registers
// into the copy so the unwinder never reads the live, changing stack.
void rewriteStack(unsigned char* buffer, quint64 bottom, size_t size, CONTEXT* context)
{
  const auto copy = quint64(buffer);
  auto* words = reinterpret_cast<DWORD64*>(buffer);
  for (size_t i = 0; i < size / sizeof(DWORD64); ++i)
    rebase(words[i], bottom, size, copy);
  for (DWORD64* reg : {&context->Rsp, &context->Rbp, &context->Rbx, &context->Rsi, &context->Rdi,
                       &context->R12, &context->R13, &context->R14, &context->R15})
    rebase(*reg, bottom, size, copy);
}

int unwind(CONTEXT* context, quint64 low, quint64 high, quint64* frames)
{
  int count = 0;
  __try
  {
    while (count < MaxFrames && context->Rip)
    {
      frames[count++] = context->Rip;
      DWORD64 imageBase = 0;
      const auto function = RtlLookupFunctionEntry(context->Rip, &imageBase, nullptr);
      if (function)
      {
        PVOID handlerData = nullptr;
        DWORD64 establisherFrame = 0;
        RtlVirtualUnwind(UNW_FLAG_NHANDLER, imageBase, context->Rip, function, context,
                         &handlerData, &establisherFrame, nullptr);
      }
      else
      {
        // A leaf function keeps its return address at the stack pointer.
        if (context->Rsp < low || context->Rsp + sizeof(DWORD64) > high)
          break;
        context->Rip = *reinterpret_cast<const DWORD64*>(context->Rsp);
        context->Rsp += sizeof(DWORD64);
      }
      if (context->Rsp < low || context->Rsp >= high)
        break;
    }
  }
  __except (EXCEPTION_EXECUTE_HANDLER)
  {
  }
  return count;
}

quint64 stackBase(HANDLE thread, NtQueryInformationThreadFn query)
{
  ThreadBasicInformation info{};
  if (!query || query(thread, 0, &info, sizeof(info), nullptr) < 0 || !info.tebBaseAddress)
    return 0;
  NT_TIB tib{};
  if (!copyMemory(&tib, info.tebBaseAddress, sizeof(tib)))
    return 0;
  return quint64(tib.StackBase);
}

// Module base names only: absolute paths would identify the user and are
// rejected by the report sanitizer.
std::vector<Module> loadedModules()
{
  std::vector<HMODULE> handles(1024);
  DWORD needed = 0;
  const auto process = GetCurrentProcess();
  if (!K32EnumProcessModules(process, handles.data(), DWORD(handles.size() * sizeof(HMODULE)), &needed))
    return {};
  handles.resize(std::min<size_t>(handles.size(), needed / sizeof(HMODULE)));
  std::vector<Module> modules;
  for (const auto handle : handles)
  {
    MODULEINFO info{};
    wchar_t name[MAX_PATH]{};
    if (!K32GetModuleInformation(process, handle, &info, sizeof(info)) ||
        !K32GetModuleBaseNameW(process, handle, name, MAX_PATH))
      continue;
    const auto base = quint64(info.lpBaseOfDll);
    modules.push_back({base, base + info.SizeOfImage, QString::fromWCharArray(name)});
  }
  std::sort(modules.begin(), modules.end(), [](const Module& a, const Module& b) { return a.base < b.base; });
  return modules;
}

QString frameName(const std::vector<Module>& modules, quint64 address)
{
  const auto next = std::upper_bound(modules.begin(), modules.end(), address,
                                     [](quint64 value, const Module& module) { return value < module.base; });
  if (next != modules.begin())
  {
    const auto& module = *(next - 1);
    if (address < module.end)
      return QStringLiteral("%1+0x%2").arg(module.name).arg(address - module.base, 0, 16);
  }
  return QStringLiteral("0x%1").arg(address, 0, 16);
}

QString threadName(HANDLE thread, GetThreadDescriptionFn describe)
{
  PWSTR text = nullptr;
  QString name;
  if (describe && SUCCEEDED(describe(thread, &text)) && text)
  {
    name = QString::fromWCharArray(text);
    LocalFree(text);
  }
  QString safe;
  for (const QChar c : name)
    if (c.isLetterOrNumber() || QStringLiteral(" _-.:#").contains(c))
      safe += c;
  return safe.left(48);
}

// Threads sampled again after the first, full sample: the ones a GUI stall
// usually waits on (mpv core and video output, Qt Quick and Chromium rendering).
bool resampled(const QString& name)
{
  return name == QLatin1String("core") || name == QLatin1String("vo") || name.startsWith(QLatin1String("QSG")) ||
         name.contains(QLatin1String("Gpu")) || name.contains(QLatin1String("Compositor"));
}
#endif

void writeFaultFile(const QString& path, const QDateTime& startedAt, qint64 stalledMs, const QStringList& stacks)
{
  if (path.isEmpty())
    return;
  QJsonObject fault{{"version", 1}, {"kind", "main-thread-stall"},
                    {"appVersion", Version::GetVersionString()},
                    {"startedAt", startedAt.toString(Qt::ISODateWithMs)},
                    {"stalledMs", stalledMs}, {"stacks", QJsonArray::fromStringList(stacks)}};
  QSaveFile file(path);
  if (file.open(QIODevice::WriteOnly) && file.write(QJsonDocument(fault).toJson(QJsonDocument::Compact)) >= 0)
    file.commit();
}
}

MainThreadWatchdog::MainThreadWatchdog(QObject* parent) : QObject(parent)
{
  m_heartbeat.setTimerType(Qt::CoarseTimer);
  connect(&m_heartbeat, &QTimer::timeout, this, &MainThreadWatchdog::beat);
}

MainThreadWatchdog::~MainThreadWatchdog()
{
  stop();
}

bool MainThreadWatchdog::supported()
{
#ifdef TIGEREST_STALL_STACKS
  return true;
#else
  return false;
#endif
}

bool MainThreadWatchdog::start(const QString& faultFile, const Options& options)
{
  if (!supported())
    return false;
  if (running())
    return true;
#ifdef TIGEREST_STALL_STACKS
  m_mainThreadId = GetCurrentThreadId();
#endif
  m_options = options;
  m_faultFile = faultFile;
  m_lastBeat = steadyMs();
  m_stopping = false;
  m_heartbeat.setInterval(m_options.beatMs);
  m_heartbeat.start();
  m_thread = std::thread([this] { run(); });
  return true;
}

void MainThreadWatchdog::stop()
{
  {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_stopping = true;
  }
  m_wake.notify_all();
  if (m_thread.joinable())
    m_thread.join();
  m_heartbeat.stop();
}

void MainThreadWatchdog::beat()
{
  m_lastBeat = steadyMs();
}

void MainThreadWatchdog::run()
{
#ifdef TIGEREST_STALL_STACKS
  if (const auto name = reinterpret_cast<SetThreadDescriptionFn>(
        GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "SetThreadDescription")))
    name(GetCurrentThread(), L"TigerestWatchdog");
#endif
  qint64 lastWake = steadyMs();
  qint64 stalledBeat = 0;
  QDateTime startedAt;
  int nextSample = 0;
  QStringList firstSample;
  std::unique_lock<std::mutex> lock(m_mutex);
  while (!m_stopping)
  {
    m_wake.wait_for(lock, std::chrono::milliseconds(m_options.pollMs));
    if (m_stopping)
      break;
    lock.unlock();
    const qint64 now = steadyMs();
    // Waking far too late means the system slept or the process was paused.
    // The watched thread did not stall then; restart its clock.
    const bool resumed = now - lastWake > m_options.pollMs + 2000;
    lastWake = now;
    qint64 beat = m_lastBeat.load();
    if (!stalledBeat)
    {
      if (resumed)
        m_lastBeat.compare_exchange_strong(beat, now);
      else if (now - beat >= m_options.stallMs && !debuggerAttached())
      {
        stalledBeat = beat;
        startedAt = QDateTime::currentDateTimeUtc().addMSecs(beat - now);
        nextSample = 0;
        firstSample.clear();
      }
    }
    if (stalledBeat && beat != stalledBeat)
    {
      const qint64 duration = beat - stalledBeat;
      qWarning().noquote() << QStringLiteral("Main thread recovered after %1 ms").arg(duration);
      // A scanner may hold the file briefly. Left behind, it would be reported
      // again as a stall that never recovered.
      for (int attempt = 0; attempt < 20 && !m_faultFile.isEmpty() && QFile::exists(m_faultFile); ++attempt)
        if (!QFile::remove(m_faultFile))
          std::this_thread::sleep_for(std::chrono::milliseconds(50));
      const QVariantMap fault{{"kind", "main-thread-stall"}, {"durationMs", duration},
                              {"startedAt", startedAt.toString(Qt::ISODateWithMs)},
                              {"samples", nextSample}};
      QMetaObject::invokeMethod(this, [this, fault] { emit stallRecovered(fault); }, Qt::QueuedConnection);
      stalledBeat = 0;
    }
    else if (stalledBeat && nextSample < m_options.sampleAtMs.size() &&
             now - stalledBeat >= m_options.sampleAtMs.at(nextSample))
    {
      const qint64 age = now - stalledBeat;
      const bool allThreads = nextSample == 0;
      const auto stacks = captureStacks(m_mainThreadId, allThreads);
      qCritical().noquote() << QStringLiteral("Main thread unresponsive for %1 ms; stack sample %2/%3, %4 threads")
                                 .arg(age).arg(nextSample + 1).arg(m_options.sampleAtMs.size()).arg(stacks.size());
      for (const auto& record : stacks)
        qCritical().noquote() << record;
      if (allThreads)
        firstSample = stacks;
      QStringList saved = firstSample;
      if (!allThreads)
        saved << QStringLiteral("-- sample %1 at %2 ms --").arg(nextSample + 1).arg(age) << stacks;
      writeFaultFile(m_faultFile, startedAt, age, saved);
      ++nextSample;
    }
    lock.lock();
  }
}

QStringList MainThreadWatchdog::captureStacks(quint32 mainThreadId, bool allThreads)
{
  QStringList records;
#ifdef TIGEREST_STALL_STACKS
  const auto query = reinterpret_cast<NtQueryInformationThreadFn>(
    GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationThread"));
  const auto describe = reinterpret_cast<GetThreadDescriptionFn>(
    GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetThreadDescription"));
  const DWORD self = GetCurrentThreadId();
  const DWORD process = GetCurrentProcessId();
  std::vector<DWORD> ids;
  const HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot != INVALID_HANDLE_VALUE)
  {
    THREADENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    for (BOOL more = Thread32First(snapshot, &entry); more; more = Thread32Next(snapshot, &entry))
      if (entry.th32OwnerProcessID == process && entry.th32ThreadID != self)
        ids.push_back(entry.th32ThreadID);
    CloseHandle(snapshot);
  }
  std::stable_partition(ids.begin(), ids.end(), [mainThreadId](DWORD id) { return id == mainThreadId; });
  const auto modules = loadedModules();
  std::vector<unsigned char> buffer(StackCopyBytes);
  for (const DWORD id : ids)
  {
    if (records.size() >= MaxThreads)
      break;
    const HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE, id);
    if (!thread)
      continue;
    const bool main = id == mainThreadId;
    const auto name = threadName(thread, describe);
    if (!allThreads && !main && !resampled(name))
    {
      CloseHandle(thread);
      continue;
    }
    CONTEXT context{};
    quint64 bottom = 0;
    size_t size = 0;
    quint64 frames[MaxFrames];
    int count = 0;
    const quint64 base = stackBase(thread, query);
    if (base && suspendAndCopy(thread, base, buffer.data(), &context, &bottom, &size))
    {
      rewriteStack(buffer.data(), bottom, size, &context);
      count = unwind(&context, quint64(buffer.data()), quint64(buffer.data()) + size, frames);
    }
    CloseHandle(thread);
    QString record = QStringLiteral("Stall stack tid=%1%2%3 frames=%4")
                       .arg(id)
                       .arg(main ? QStringLiteral(" [main]") : QString())
                       .arg(name.isEmpty() ? QString() : QStringLiteral(" \"%1\"").arg(name))
                       .arg(count);
    for (int i = 0; i < count; ++i)
      record += QStringLiteral("\n  #%1 %2").arg(i, 2, 10, QLatin1Char('0')).arg(frameName(modules, frames[i]));
    records << record;
  }
#else
  Q_UNUSED(mainThreadId);
  Q_UNUSED(allThreads);
#endif
  return records;
}

QVariantMap MainThreadWatchdog::takeUnfinishedFault(const QString& faultFile)
{
  QFile file(faultFile);
  if (faultFile.isEmpty() || !file.exists())
    return {};
  QByteArray bytes;
  if (file.size() <= MaxFaultFileBytes && file.open(QIODevice::ReadOnly))
    bytes = file.readAll();
  file.close();
  QFile::remove(faultFile);
  const auto fault = QJsonDocument::fromJson(bytes).object();
  if (fault.value("version").toInt() != 1 || fault.value("kind").toString() != QLatin1String("main-thread-stall"))
    return {};
  QStringList stacks;
  for (const auto& value : fault.value("stacks").toArray())
    if (value.isString())
      stacks << value.toString();
  return {{"kind", "main-thread-stall"}, {"unrecovered", true},
          {"appVersion", fault.value("appVersion").toString()},
          {"startedAt", fault.value("startedAt").toString()},
          {"durationMs", fault.value("stalledMs").toVariant().toLongLong()},
          {"stacks", stacks}};
}

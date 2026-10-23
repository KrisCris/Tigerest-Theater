#include "ThreadSampler.h"

#include <windows.h>
#include <winternl.h>
#include <tlhelp32.h>
#include <psapi.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <QQuickWindow>

namespace
{
// A module file mapped into this process: the one this process runs, or an
// image-only mapping of a renderer's module that this process does not load
// (the build tree's renderers run the stock WebEngine from the Qt prefix).
struct Image
{
  DWORD64 base = 0, size = 0;
  std::string name;
};

// A module of a renderer: where it is loaded there, and its image here.
struct Remap
{
  DWORD64 remote = 0, size = 0;
  const Image *image = nullptr;
};

struct Process
{
  HANDLE handle = nullptr;
  std::vector<Remap> modules;
};

struct Target
{
  HANDLE handle = nullptr;
  const Process *process = nullptr; // null: this process
  std::string name;
};

constexpr size_t STACK_COPY = 256 * 1024;
constexpr size_t STACK_SLACK = 64 * 1024; // a last frame's reads may pass the copied end
constexpr int MAX_FRAMES = 14;
constexpr DWORD64 JIT = 1; // a frame in no module: V8 generated code

std::map<std::wstring, Image> images;    // by path; sampler thread only
std::vector<const Image *> mappedImages; // those mapped here only for renderers

double wallMs()
{
  FILETIME ft;
  GetSystemTimePreciseAsFileTime(&ft);
  ULARGE_INTEGER u;
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  return (u.QuadPart - 116444736000000000ULL) / 10000.0;
}

DWORD64 stackBase(HANDLE thread, HANDLE process)
{
  using Query = NTSTATUS(NTAPI *)(HANDLE, THREADINFOCLASS, PVOID, ULONG, PULONG);
  struct BasicInformation
  {
    NTSTATUS exitStatus;
    PVOID teb;
    CLIENT_ID clientId;
    KAFFINITY affinity;
    LONG priority;
    LONG basePriority;
  } info{};
  static auto query = reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationThread"));
  if (!query || query(thread, static_cast<THREADINFOCLASS>(0), &info, sizeof(info), nullptr) != 0 || !info.teb)
    return 0;
  if (!process)
    return reinterpret_cast<DWORD64>(reinterpret_cast<NT_TIB *>(info.teb)->StackBase);
  NT_TIB tib{};
  return ReadProcessMemory(process, info.teb, &tib, sizeof(tib), nullptr) ? reinterpret_cast<DWORD64>(tib.StackBase) : 0;
}

const IMAGE_NT_HEADERS64 *headers(DWORD64 base)
{
  return reinterpret_cast<const IMAGE_NT_HEADERS64 *>(base + reinterpret_cast<const IMAGE_DOS_HEADER *>(base)->e_lfanew);
}

// The image's function table entry covering rva (RtlLookupFunctionEntry only
// knows modules the loader registered).
PRUNTIME_FUNCTION lookup(const Image &image, DWORD64 rva)
{
  const IMAGE_DATA_DIRECTORY &table = headers(image.base)->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION];
  auto *first = reinterpret_cast<PRUNTIME_FUNCTION>(image.base + table.VirtualAddress), *last = first + table.Size / sizeof(RUNTIME_FUNCTION);
  auto *entry = std::upper_bound(first, last, rva, [](DWORD64 at, const RUNTIME_FUNCTION &f) { return at < f.BeginAddress; });
  if (entry == first || rva >= (--entry)->EndAddress)
    return nullptr;
  if (entry->UnwindData & 1)
    entry = reinterpret_cast<PRUNTIME_FUNCTION>(image.base + (entry->UnwindData & ~1u));
  return entry;
}

// The register (CONTEXT order from Rax) a function's unwind info rebuilds the
// stack pointer from, following chained entries; 0 when there is none.
int frameRegister(DWORD64 imageBase, const RUNTIME_FUNCTION *function)
{
  for (int depth = 0; depth < 8; ++depth)
  {
    const auto *info = reinterpret_cast<const unsigned char *>(imageBase + function->UnwindData);
    if (info[3] & 0x0f)
      return info[3] & 0x0f;
    if (!((info[0] >> 3) & UNW_FLAG_CHAININFO))
      return 0;
    function = reinterpret_cast<const RUNTIME_FUNCTION *>(info + 4 + ((info[2] + 1) & ~1) * 2);
  }
  return 0;
}

bool unwind(DWORD64 imageBase, PRUNTIME_FUNCTION function, CONTEXT &context)
{
  __try
  {
    PVOID handler = nullptr;
    DWORD64 establisher = 0;
    RtlVirtualUnwind(UNW_FLAG_NHANDLER, imageBase, context.Rip, function, &context, &handler, &establisher, nullptr);
    return true;
  }
  __except (EXCEPTION_EXECUTE_HANDLER)
  {
    return false;
  }
}

// Copies the suspended thread's registers and the top of its stack, then
// unwinds the copy after resuming it, so no lock the target may hold is taken
// while it is suspended (the approach of Chromium's stack sampling profiler).
// A renderer's stack is read across processes and unwound with the tables of
// the module files it runs, mapped here.
int sample(HANDLE thread, const Process *owner, DWORD64 base, std::vector<unsigned char> &copy, DWORD64 *frames)
{
  const HANDLE process = owner ? owner->handle : nullptr;
  CONTEXT context{};
  context.ContextFlags = CONTEXT_FULL;
  size_t size = 0;
  if (SuspendThread(thread) == static_cast<DWORD>(-1))
    return 0;
  if (GetThreadContext(thread, &context) && context.Rsp < base)
  {
    size = static_cast<size_t>(std::min<DWORD64>(base - context.Rsp, STACK_COPY));
    if (!process)
      std::memcpy(copy.data(), reinterpret_cast<void *>(context.Rsp), size);
    else if (!ReadProcessMemory(process, reinterpret_cast<void *>(context.Rsp), copy.data(), size, nullptr))
      size = 0;
  }
  ResumeThread(thread);
  if (size < 8)
    return 0;

  const DWORD64 top = context.Rsp, end = top + size, shift = reinterpret_cast<DWORD64>(copy.data()) - top;
  auto rewrite = [&](DWORD64 &value) { if (value >= top && value < end) value += shift; };
  for (size_t at = 0; at + 8 <= size; at += 8)
    rewrite(*reinterpret_cast<DWORD64 *>(copy.data() + at));
  for (DWORD64 *reg : {&context.Rsp, &context.Rbp, &context.Rbx, &context.Rsi, &context.Rdi,
                       &context.R12, &context.R13, &context.R14, &context.R15})
    rewrite(*reg);

  const DWORD64 low = reinterpret_cast<DWORD64>(copy.data()), high = low + size;
  int count = 0;
  while (count < MAX_FRAMES && context.Rip && context.Rsp >= low && context.Rsp <= high - 8)
  {
    DWORD64 imageBase = 0;
    PRUNTIME_FUNCTION function = nullptr;
    if (!owner)
    {
      frames[count++] = context.Rip;
      function = RtlLookupFunctionEntry(context.Rip, &imageBase, nullptr);
    }
    else
    {
      const auto module = std::find_if(owner->modules.begin(), owner->modules.end(),
                                       [&](const Remap &m) { return context.Rip - m.remote < m.size; });
      if (module == owner->modules.end())
      {
        // V8 generated code, which keeps a frame pointer chain.
        frames[count++] = JIT;
        if (context.Rbp < context.Rsp || context.Rbp > high - 16)
          break;
        const DWORD64 *frame = reinterpret_cast<const DWORD64 *>(context.Rbp);
        context.Rip = frame[1];
        context.Rsp = context.Rbp + 16;
        context.Rbp = frame[0];
        continue;
      }
      const DWORD64 rva = context.Rip - module->remote;
      imageBase = module->image->base;
      context.Rip = imageBase + rva;
      frames[count++] = context.Rip;
      function = lookup(*module->image, rva);
      // A frame pointer outside the copy is an address of the other process;
      // unwinding through it would read this process's memory there.
      const int reg = function ? frameRegister(imageBase, function) : 0;
      if (reg > 0 && ((&context.Rax)[reg] < low || (&context.Rax)[reg] > high - 8))
        break;
    }
    if (!function)
    {
      context.Rip = *reinterpret_cast<DWORD64 *>(context.Rsp);
      context.Rsp += 8;
      continue;
    }
    if (!unwind(imageBase, function, context))
      break;
  }
  return count;
}

std::string moduleName(const wchar_t *path)
{
  const wchar_t *name = wcsrchr(path, L'\\');
  char narrow[MAX_PATH] = {};
  WideCharToMultiByte(CP_UTF8, 0, name ? name + 1 : path, -1, narrow, MAX_PATH, nullptr, nullptr);
  return narrow;
}

std::string frameName(DWORD64 address, std::map<DWORD64, std::string> &modules)
{
  if (address == JIT)
    return "jit";
  char offset[32];
  for (const Image *image : mappedImages)
    if (address - image->base < image->size)
    {
      std::snprintf(offset, sizeof(offset), "+%llx", static_cast<unsigned long long>(address - image->base));
      return image->name + offset;
    }
  HMODULE module = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                          reinterpret_cast<LPCWSTR>(address), &module))
    return "?";
  const DWORD64 base = reinterpret_cast<DWORD64>(module);
  auto known = modules.find(base);
  if (known == modules.end())
  {
    wchar_t path[MAX_PATH] = {};
    GetModuleFileNameW(module, path, MAX_PATH);
    known = modules.emplace(base, moduleName(path)).first;
  }
  std::snprintf(offset, sizeof(offset), "+%llx", static_cast<unsigned long long>(address - base));
  return known->second + offset;
}

bool wanted(const std::string &name)
{
  for (const char *prefix : {"CrBrowserMain", "Chrome_InProcGpuThread", "CrGpuMain", "VizCompositorThread",
                             "CompositorGpuThread", "QSGRenderThread", "Chrome_IOThread"})
    if (name.rfind(prefix, 0) == 0)
      return true;
  return false;
}

bool wantedInRenderer(const std::string &name)
{
  for (const char *exact : {"CrRendererMain", "Compositor", "Chrome_ChildIOThread"})
    if (name == exact)
      return true;
  return name.rfind("CompositorTileWorker", 0) == 0;
}

// The module file at path, as this process sees it: loaded here already, or
// mapped as an image for its unwind tables only. Renderer-only modules are
// named "r!<file>" so their offsets are read against the renderer's file.
const Image &image(const std::wstring &path)
{
  auto known = images.find(path);
  if (known != images.end())
    return known->second;
  Image result;
  if (HMODULE here = GetModuleHandleW(path.c_str()))
    result.base = reinterpret_cast<DWORD64>(here);
  else if (HMODULE mapped = LoadLibraryExW(path.c_str(), nullptr, LOAD_LIBRARY_AS_IMAGE_RESOURCE))
  {
    result.base = reinterpret_cast<DWORD64>(mapped) & ~DWORD64(3);
    result.name = "r!" + moduleName(path.c_str());
  }
  if (result.base)
    result.size = headers(result.base)->OptionalHeader.SizeOfImage;
  Image &stored = images.emplace(path, result).first->second;
  if (!stored.name.empty())
    mappedImages.push_back(&stored);
  return stored;
}

void remap(Process &process)
{
  process.modules.clear();
  HMODULE modules[1024];
  DWORD bytes = 0;
  if (!K32EnumProcessModulesEx(process.handle, modules, sizeof(modules), &bytes, LIST_MODULES_64BIT))
    return;
  for (DWORD i = 0; i < std::min<DWORD>(bytes / sizeof(HMODULE), 1024); ++i)
  {
    wchar_t path[MAX_PATH] = {};
    MODULEINFO info{};
    if (!K32GetModuleFileNameExW(process.handle, modules[i], path, MAX_PATH)
        || !K32GetModuleInformation(process.handle, modules[i], &info, sizeof(info)))
      continue;
    const Image &here = image(path);
    if (here.base)
      process.modules.push_back({reinterpret_cast<DWORD64>(info.lpBaseOfDll), info.SizeOfImage, &here});
  }
}

// Child QtWebEngineProcess instances (renderers), by process id.
void children(std::map<DWORD, Process> &processes)
{
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE)
    return;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  for (BOOL more = Process32FirstW(snapshot, &entry); more; more = Process32NextW(snapshot, &entry))
  {
    if (entry.th32ParentProcessID != GetCurrentProcessId() || processes.count(entry.th32ProcessID)
        || _wcsicmp(entry.szExeFile, L"QtWebEngineProcess.exe") != 0)
      continue;
    if (HANDLE process = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE, entry.th32ProcessID))
      processes[entry.th32ProcessID].handle = process;
  }
  CloseHandle(snapshot);
  for (auto &[id, process] : processes)
    remap(process);
}

void refresh(std::map<DWORD, Target> &targets, std::map<DWORD, Process> &processes, DWORD guiThread)
{
  children(processes);
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE)
    return;
  THREADENTRY32 entry{};
  entry.dwSize = sizeof(entry);
  for (BOOL more = Thread32First(snapshot, &entry); more; more = Thread32Next(snapshot, &entry))
  {
    const bool own = entry.th32OwnerProcessID == GetCurrentProcessId();
    const auto child = processes.find(entry.th32OwnerProcessID);
    if ((!own && child == processes.end()) || targets.count(entry.th32ThreadID))
      continue;
    HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE, entry.th32ThreadID);
    if (!thread)
      continue;
    std::string name;
    PWSTR description = nullptr;
    if (SUCCEEDED(GetThreadDescription(thread, &description)) && description)
    {
      char narrow[128] = {};
      WideCharToMultiByte(CP_UTF8, 0, description, -1, narrow, sizeof(narrow), nullptr, nullptr);
      name = narrow;
      LocalFree(description);
    }
    if (entry.th32ThreadID == guiThread)
      name = "gui" + (name.empty() ? std::string() : ":" + name);
    if (own && (entry.th32ThreadID == guiThread || wanted(name)))
      targets[entry.th32ThreadID] = {thread, nullptr, name};
    else if (!own && wantedInRenderer(name))
      targets[entry.th32ThreadID] = {thread, &child->second, "r" + std::to_string(entry.th32OwnerProcessID) + ":" + name};
    else
      CloseHandle(thread);
  }
  CloseHandle(snapshot);
}
}

void ThreadSampler::startFromEnvironment()
{
  wchar_t path[MAX_PATH] = {};
  if (!GetEnvironmentVariableW(L"TIGEREST_THREAD_SAMPLES", path, MAX_PATH))
    return;
  const DWORD guiThread = GetCurrentThreadId();
  std::thread([guiThread, file = std::wstring(path)] {
    FILE *out = _wfopen(file.c_str(), L"w");
    if (!out)
      return;
    SetThreadDescription(GetCurrentThread(), L"TigerestThreadSampler");
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
    std::map<DWORD, Target> targets;
    std::map<DWORD, Process> processes;
    std::map<DWORD64, std::string> modules;
    std::vector<unsigned char> copy(STACK_COPY + STACK_SLACK);
    DWORD64 frames[MAX_FRAMES];
    double lastRefresh = 0;
    for (;;)
    {
      const double now = wallMs();
      if (now - lastRefresh > 1000)
      {
        refresh(targets, processes, guiThread);
        lastRefresh = now;
      }
      for (auto &[id, target] : targets)
      {
        const DWORD64 base = stackBase(target.handle, target.process ? target.process->handle : nullptr);
        const double at = wallMs();
        const int count = base ? sample(target.handle, target.process, base, copy, frames) : 0;
        if (!count)
          continue;
        std::fprintf(out, "%.2f\t%s", at, target.name.c_str());
        for (int i = 0; i < count; ++i)
          std::fprintf(out, "\t%s", frameName(frames[i], modules).c_str());
        std::fputc('\n', out);
      }
      LARGE_INTEGER due;
      due.QuadPart = -10000; // 1 ms
      if (timer && SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE))
        WaitForSingleObject(timer, INFINITE);
      else
        Sleep(1);
    }
  }).detach();
}

void ThreadSampler::recordFramesFromEnvironment(QQuickWindow *window)
{
  wchar_t path[MAX_PATH] = {};
  if (!window || !GetEnvironmentVariableW(L"TIGEREST_FRAME_TIMES", path, MAX_PATH))
    return;
  static std::mutex lock;
  static std::vector<double> pending;
  // The render thread only appends; a writer thread empties the list to the
  // file, so a test that kills the process loses at most the last 250 ms.
  QObject::connect(window, &QQuickWindow::frameSwapped, window, [] {
    const double at = wallMs();
    std::lock_guard<std::mutex> guard(lock);
    pending.push_back(at);
  }, Qt::DirectConnection);
  std::thread([file = std::wstring(path)] {
    FILE *out = _wfopen(file.c_str(), L"w");
    if (!out)
      return;
    SetThreadDescription(GetCurrentThread(), L"TigerestFrameTimes");
    std::vector<double> batch;
    for (;;)
    {
      Sleep(250);
      {
        std::lock_guard<std::mutex> guard(lock);
        batch.swap(pending);
      }
      for (double at : batch)
        std::fprintf(out, "%.3f\n", at);
      std::fflush(out);
      batch.clear();
    }
  }).detach();
}

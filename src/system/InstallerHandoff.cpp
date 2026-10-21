#include "InstallerHandoff.h"

#ifdef Q_OS_WIN
#include <QDir>
#include <QWinEventNotifier>
#include <windows.h>
#include <shellapi.h>

InstallerHandoff::InstallerHandoff(QObject* parent) : QObject(parent) {}

InstallerHandoff::~InstallerHandoff() { release(); }

QString InstallerHandoff::eventName(quint32 processId)
{
  return QStringLiteral("Local\\TigerestTheaterUpdate-%1").arg(processId);
}

QStringList InstallerHandoff::arguments(quint32 processId)
{
  // /CLOSEAPPLICATIONS stays as a fallback for helper processes still holding files.
  return {"/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
          "/TIGERESTRELAUNCH=1", QStringLiteral("/TIGERESTPID=%1").arg(processId)};
}

bool InstallerHandoff::start(const QString& installer, const QStringList& extraArguments)
{
  if (running()) return false;
  const quint32 processId = GetCurrentProcessId();
  m_event = CreateEventW(nullptr, TRUE, FALSE, reinterpret_cast<LPCWSTR>(eventName(processId).utf16()));
  if (!m_event) return false;
  ResetEvent(m_event);
  const QString path = QDir::toNativeSeparators(installer);
  const QString parameters = (arguments(processId) + extraArguments).join(' ');
  SHELLEXECUTEINFOW launch = {};
  launch.cbSize = sizeof(launch);
  launch.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
  launch.lpVerb = L"open"; // Respect the installer's elevation manifest.
  launch.lpFile = reinterpret_cast<LPCWSTR>(path.utf16());
  launch.lpParameters = reinterpret_cast<LPCWSTR>(parameters.utf16());
  launch.nShow = SW_SHOWNORMAL;
  if (!ShellExecuteExW(&launch) || !launch.hProcess)
  {
    if (launch.hProcess) CloseHandle(launch.hProcess);
    release();
    return false;
  }
  m_process = launch.hProcess;
  m_eventNotifier = new QWinEventNotifier(m_event, this);
  m_processNotifier = new QWinEventNotifier(m_process, this);
  connect(m_eventNotifier, &QWinEventNotifier::activated, this, [this] { release(); emit closeRequested(); });
  // Setup's unelevated instance waits for its elevated copy, so this fires only when it is all over.
  connect(m_processNotifier, &QWinEventNotifier::activated, this, [this] {
    const bool asked = WaitForSingleObject(m_event, 0) == WAIT_OBJECT_0;
    release();
    if (asked) emit closeRequested(); else emit returned();
  });
  return true;
}

void InstallerHandoff::release()
{
  // Called from the notifiers' own signals, so they are only disabled here.
  for (QWinEventNotifier* notifier : {m_eventNotifier, m_processNotifier})
    if (notifier) { notifier->setEnabled(false); notifier->deleteLater(); }
  m_eventNotifier = m_processNotifier = nullptr;
  if (m_process) CloseHandle(m_process);
  if (m_event) CloseHandle(m_event);
  m_process = m_event = nullptr;
}
#endif

#pragma once

#include <QtGlobal>

#ifdef Q_OS_WIN
#include <QObject>
#include <QStringList>

class QWinEventNotifier;

// Runs the Inno Setup update installer without its wizard. Once the installer is past any UAC
// prompt it signals a per-process event and waits for this process to exit; it then installs
// and starts the new version as the original user (bundle/win/UpdateHandoff.iss).
class InstallerHandoff : public QObject
{
  Q_OBJECT
public:
  explicit InstallerHandoff(QObject* parent = nullptr);
  ~InstallerHandoff() override;
  // False when the installer could not be started; nothing is waiting then.
  bool start(const QString& installer, const QStringList& extraArguments = {});
  bool running() const { return m_process != nullptr; }
  static QString eventName(quint32 processId);
  static QStringList arguments(quint32 processId);
signals:
  // The installer is ready to replace the files: quit now, it relaunches the new version.
  void closeRequested();
  // The installer ended without asking for that, e.g. its UAC prompt was declined.
  void returned();
private:
  void release();
  void* m_event = nullptr;
  void* m_process = nullptr;
  QWinEventNotifier* m_eventNotifier = nullptr;
  QWinEventNotifier* m_processNotifier = nullptr;
};
#endif

// Plays the client in test_installer_handoff.py: starts a real Inno Setup installer through
// InstallerHandoff and records what happens. Started without arguments (by the installer's
// relaunch entry) it only records that it was relaunched from the install directory.
#include "system/InstallerHandoff.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QTimer>

static void mark(const QString& path, const QByteArray& line)
{
  QFile file(path);
  if (file.open(QIODevice::Append)) file.write(line + "\n");
}

int main(int argc, char** argv)
{
  QCoreApplication app(argc, argv);
  const QStringList args = app.arguments();
  if (args.size() == 1)
  {
    mark(QDir(app.applicationDirPath()).filePath("relaunched.txt"), "relaunched");
    return 0;
  }
  if (args.size() < 4 || args[1] != "client") return 1;
  const QString marker = args[2];
  InstallerHandoff handoff;
  QObject::connect(&handoff, &InstallerHandoff::closeRequested, &app, [&] {
    mark(marker, "close-requested");
    // Like the real client, take a moment to shut down; Setup must wait for it.
    QTimer::singleShot(1500, &app, [&] { mark(marker, "exiting"); app.quit(); });
  });
  QObject::connect(&handoff, &InstallerHandoff::returned, &app, [&] { mark(marker, "returned"); app.exit(2); });
  if (!handoff.start(args[3], args.mid(4)))
  {
    mark(marker, "start-failed");
    return 3;
  }
  mark(marker, "started");
  QTimer::singleShot(120000, &app, [&] { mark(marker, "timeout"); app.exit(4); });
  return app.exec();
}

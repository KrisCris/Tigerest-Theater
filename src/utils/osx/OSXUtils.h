#ifndef OSXUTILS_H
#define OSXUTILS_H

#include <QString>
#include <ApplicationServices/ApplicationServices.h>

class QScreen;

namespace OSXUtils
{
  QString ComputerName();
  OSStatus SendAppleEventToSystemProcess(AEEventID eventToSendID);

  void SetCursorVisible(bool visible);

  // True when the display under this screen can show EDR/HDR above SDR white
  // (XDR, Pro Display XDR, HDR external monitors with HDR enabled).
  bool ScreenSupportsEDR(const QScreen* screen);
};

#endif /* OSXUTILS_H */

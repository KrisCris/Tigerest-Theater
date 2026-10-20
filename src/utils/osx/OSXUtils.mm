#include "OSXUtils.h"
#include <QDebug>
#include <QScreen>
#import <Cocoa/Cocoa.h>

/////////////////////////////////////////////////////////////////////////////////////////
QString OSXUtils::ComputerName()
{
  return QString::fromNSString([[NSHost currentHost] localizedName]);
}

/////////////////////////////////////////////////////////////////////////////////////////
OSStatus OSXUtils::SendAppleEventToSystemProcess(AEEventID eventToSendID)
{
  AEAddressDesc targetDesc;
  static const  ProcessSerialNumber kPSNOfSystemProcess = {0, kSystemProcess };
  AppleEvent    eventReply  = {typeNull, nullptr};
  AppleEvent    eventToSend = {typeNull, nullptr};

  OSStatus status = AECreateDesc(typeProcessSerialNumber,
    &kPSNOfSystemProcess, sizeof(kPSNOfSystemProcess), &targetDesc);

  if (status != noErr)
    return status;

  status = AECreateAppleEvent(kCoreEventClass, eventToSendID,
    &targetDesc, kAutoGenerateReturnID, kAnyTransactionID, &eventToSend);
  AEDisposeDesc(&targetDesc);

  if (status != noErr)
    return status;

  status = AESendMessage(&eventToSend, &eventReply, kAENormalPriority, kAEDefaultTimeout);
  AEDisposeDesc(&eventToSend);

  if (status != noErr)
    return status;

  AEDisposeDesc(&eventReply);

  return status;
}

/////////////////////////////////////////////////////////////////////////////////////////
void OSXUtils::SetCursorVisible(bool visible)
{
  if (visible)
    [NSCursor unhide];
  else
    [NSCursor hide];
}

/////////////////////////////////////////////////////////////////////////////////////////
bool OSXUtils::ScreenSupportsEDR(const QScreen* screen)
{
  if (!screen)
    return false;
  // Qt and CoreGraphics share the global top-left point space; Qt's display
  // index is not a CGDirectDisplayID.
  const QPoint center = screen->geometry().center();
  CGDirectDisplayID display = kCGNullDirectDisplay;
  uint32_t count = 0;
  if (CGGetDisplaysWithPoint(CGPointMake(center.x(), center.y()), 1, &display, &count) != kCGErrorSuccess || !count)
    return false;
  for (NSScreen* candidate in [NSScreen screens])
  {
    NSNumber* number = candidate.deviceDescription[@"NSScreenNumber"];
    if (number && number.unsignedIntValue == display)
      return candidate.maximumPotentialExtendedDynamicRangeColorComponentValue > 1.0;
  }
  return false;
}

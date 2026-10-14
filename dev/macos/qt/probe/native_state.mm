#import <AppKit/AppKit.h>

// Test-only observation of the actual Cocoa window, not just Qt's requested state.
unsigned probeNativeWindowState(void *nativeView)
{
    NSWindow *window = [(NSView *)nativeView window];
    return (window.isVisible ? 1u : 0u)
        | (window.isMiniaturized ? 2u : 0u)
        | ((window.occlusionState & NSWindowOcclusionStateVisible) ? 4u : 0u)
        | ((window.styleMask & NSWindowStyleMaskMiniaturizable) ? 8u : 0u)
        | (NSApp.activationPolicy == NSApplicationActivationPolicyRegular ? 16u : 0u);
}

void probeMinimizeNativeWindow(void *nativeView)
{
    [[(NSView *)nativeView window] miniaturize:nil];
}

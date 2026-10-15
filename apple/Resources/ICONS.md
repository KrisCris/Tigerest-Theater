# Apple application icons

All Apple clients use the existing black/gold Tigerest artwork. The macOS
source is `bundle/osx/tigerest.icns`; its 1024px image is also the source for
the checked-in iPad and tvOS asset catalogs.

To refresh the catalogs after replacing that artwork, run from the repository:

```sh
swift apple/tools/generate_icons.swift
python3 apple/tools/generate_project.py
python3 apple/tools/generate_tv_project.py
```

The iPad catalog contains opaque home-screen, Settings, Spotlight and marketing
sizes. tvOS uses a transparent foreground and opaque background for the focused
icon, plus standard and wide Top Shelf images. The Xcode generators include the
catalogs in the application resource phase and set the primary app icon name;
test bundles do not inherit that setting. Xcode compiles the catalogs and writes
the icon keys into each built application's Info.plist.

After building, verify the application signature, `Assets.car`, and
`CFBundleIcons` (`CFBundleIcons~ipad` on iPad). tvOS also includes
`TVTopShelfImage`. Update devices in place to preserve their saved accounts.

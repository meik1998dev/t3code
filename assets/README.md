# Spindle brand assets

`spindle/logo.svg` is the vector master, traced from the approved `spindle/original.png`.
Keep its two shapes and their relative placement intact. The black and white SVG/PNG
variants have transparent backgrounds.

Run `vp run icons:export` to regenerate the web, desktop, mobile, widget, and marketing
assets from the master. Run `vp run icons:check` to verify that all generated files match.
The exporter uses Sharp and runs without Xcode or Icon Composer.

Production icons use charcoal, development icons blue, and preview/nightly icons navy.
iOS and Apple touch icons have opaque square backgrounds; universal icons have rounded
corners. macOS exports retain an 824 × 824 icon body inside a 1024 × 1024 transparent
canvas. Android foreground and monochrome icons stay inside the adaptive-icon safe zone.

The three `.icon` projects are generated layered renditions for native iOS and macOS
builds, with a translucent glass foreground over the channel background. macOS packaging
uses electron-builder to compile `Assets.car` for native clear/tinted appearances and
a legacy ICNS for older systems. This requires Xcode 26 or newer; if Command Line Tools
are selected, run packaging with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
and include its `usr/bin` directory in `PATH`. The projects are not independent artwork sources. `packages/shared/src/spindleMark.ts` supplies the same paths
to web and mobile. Edit the master and regenerate rather than editing those copies or
individual PNG/ICO files.

Legacy asset filenames are kept so existing packaging and channel selection continue
to resolve the correct files.

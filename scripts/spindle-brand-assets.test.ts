// @effect-diagnostics nodeBuiltinImport:off - Build-time asset verification.
import * as NodeFSP from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

const asset = (relativePath: string) => new URL(`../${relativePath}`, import.meta.url);

describe("Spindle artwork", () => {
  it("keeps the black and white logo silhouettes identical and transparent", async () => {
    const images = await Promise.all(
      ["black", "white"].map(async (color) =>
        sharp(await NodeFSP.readFile(asset(`assets/spindle/logo-${color}.png`)))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ),
    );
    const black = images[0]!;
    const white = images[1]!;
    expect(black.info.width).toBe(1024);
    expect(black.info.height).toBe(1024);
    expect(black.info.channels).toBe(4);
    let visible = 0;
    let mismatches = 0;
    for (let i = 0; i < black.data.length; i += 4) {
      if (black.data[i + 3] !== white.data[i + 3]) mismatches++;
      if (black.data[i + 3] === 255) {
        visible++;
        for (let channel = 0; channel < 3; channel++) {
          if (black.data[i + channel] !== 0 || white.data[i + channel] !== 255) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
    expect(black.data[3]).toBe(0);
    expect(visible).toBeGreaterThan(200_000);
  });

  it("keeps macOS artwork inside the native safe area and iOS artwork opaque", async () => {
    const mac = await sharp(await NodeFSP.readFile(asset("assets/prod/black-macos-1024.png")))
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    const at = (x: number, y: number) => mac[y * 1024 + x];
    expect(at(99, 512)).toBe(0);
    expect(at(100, 512)).toBe(255);
    expect(at(923, 512)).toBe(255);
    expect(at(924, 512)).toBe(0);
    expect(at(512, 99)).toBe(0);
    expect(at(512, 100)).toBe(255);
    const ios = await sharp(
      await NodeFSP.readFile(asset("assets/prod/black-ios-1024.png")),
    ).stats();
    expect(ios.isOpaque).toBe(true);
  });

  it("keeps the Android foreground within the central adaptive-icon safe zone", async () => {
    const { data, info } = await sharp(
      await NodeFSP.readFile(asset("apps/mobile/assets/android-icon-foreground.png")),
    )
      .extractChannel("alpha")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const center = info.width / 2;
    const safeRadius = (info.width * 33) / 108;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x]! > 0) {
          expect(Math.hypot(x + 0.5 - center, y + 0.5 - center)).toBeLessThan(safeRadius);
        }
      }
    }
  });
});

#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone build-time artwork exporter.

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import sharp from "sharp";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolveWebIconOverrides,
} from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

interface IconVariant {
  readonly label: string;
  readonly source: string;
  readonly outputs: {
    readonly ios: string;
    readonly macos: string;
    readonly universal: string;
    readonly appleTouch: string;
    readonly favicon16: string;
    readonly favicon32: string;
    readonly faviconIco: string;
    readonly windowsIco: string;
  };
}

const ICON_VARIANTS = [
  {
    label: "development",
    source: BRAND_ASSET_PATHS.developmentIconComposerProject,
    outputs: {
      ios: BRAND_ASSET_PATHS.developmentIosIconPng,
      macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
      universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
      appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
      favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    },
  },
  {
    label: "preview",
    source: BRAND_ASSET_PATHS.nightlyIconComposerProject,
    outputs: {
      ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
      macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
      universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
      favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    },
  },
  {
    label: "production",
    source: BRAND_ASSET_PATHS.productionIconComposerProject,
    outputs: {
      ios: BRAND_ASSET_PATHS.productionIosIconPng,
      macos: BRAND_ASSET_PATHS.productionMacIconPng,
      universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
      appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
      favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
      faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
      windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    },
  },
] as const satisfies ReadonlyArray<IconVariant>;

const REPOSITORY_ROOT = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const BACKGROUNDS = { development: "#00639B", preview: "#111533", production: "#151515" } as const;

/** Flat icons share one vector mark; only the channel background changes. */
export function composeIconSvg(
  mark: string,
  background: string,
  inset = 0,
  rounded = true,
): string {
  const bodySize = 1024 - 2 * inset;
  const radius = rounded ? bodySize * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="${inset}" y="${inset}" width="${bodySize}" height="${bodySize}" rx="${radius}" fill="${background}"/><svg x="${inset}" y="${inset}" width="${bodySize}" height="${bodySize}" viewBox="0 0 1024 1024" fill="#fff">${mark}</svg></svg>`;
}

const render = (svg: string, size: number) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

/** Regenerate every shipped rendition, or compare without writing with --check. */
export async function exportBrandIcons(checkOnly: boolean): Promise<void> {
  const source = await NodeFSP.readFile(
    NodePath.join(REPOSITORY_ROOT, "assets/spindle/logo.svg"),
    "utf8",
  );
  const paths = [...source.matchAll(/<path d="([^"]+)"\s*\/>/g)].map((match) => match[1]!);
  if (paths.length === 0) throw new Error("The Spindle master SVG has no paths.");
  const mark = paths.map((d) => `<path d="${d}"/>`).join("");
  const transparent = (color: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="${color}">${mark}</svg>\n`;
  const generated = new Map<string, Buffer>();
  const text = (target: string, contents: string) => generated.set(target, Buffer.from(contents));

  text("assets/spindle/logo-black.svg", transparent("#000"));
  text("assets/spindle/logo-white.svg", transparent("#fff"));
  generated.set("assets/spindle/logo-black.png", await render(transparent("#000"), 1024));
  generated.set("assets/spindle/logo-white.png", await render(transparent("#fff"), 1024));
  text("apps/web/public/spindle-logo.svg", transparent("#000"));
  text("apps/marketing/public/spindle-logo.svg", transparent("#000"));
  text("apps/mobile/assets/widget/SpindleMark.svg", transparent("#000"));
  text(
    "packages/shared/src/spindleMark.ts",
    [
      "// Generated from assets/spindle/logo.svg by vp run icons:export. Do not edit.",
      'export const SPINDLE_MARK_VIEW_BOX = "0 0 1024 1024";',
      "export const SPINDLE_MARK_PATHS = [",
      ...paths.map((d) => `  ${JSON.stringify(d)},`),
      "] as const;",
      "",
    ].join("\n"),
  );

  for (const variant of ICON_VARIANTS) {
    const background = BACKGROUNDS[variant.label];
    const square = composeIconSvg(mark, background, 0, false);
    const universal = composeIconSvg(mark, background);
    const outputs = variant.outputs;
    generated.set(outputs.ios, await render(square, 1024));
    generated.set(outputs.universal, await render(universal, 1024));
    // macOS needs an 824px icon body inside a 1024px canvas, not a full-bleed iOS icon.
    generated.set(outputs.macos, await render(composeIconSvg(mark, background, 100), 1024));
    generated.set(outputs.appleTouch, await render(square, 180));
    generated.set(outputs.favicon16, await render(universal, 16));
    generated.set(outputs.favicon32, await render(universal, 32));
    const renditions = await Promise.all(
      WINDOWS_ICON_SIZES.map(async (size) => ({ size, contents: await render(universal, size) })),
    );
    const ico = encodePngIco(renditions);
    generated.set(outputs.faviconIco, ico);
    generated.set(outputs.windowsIco, ico);

    // Native Apple builds use layered artwork so the OS renders glass and tinted appearances.
    text(`${variant.source}/Assets/mark.svg`, transparent("#fff"));
    const [r, g, b] = [1, 3, 5].map(
      (offset) => Number.parseInt(background.slice(offset, offset + 2), 16) / 255,
    );
    text(
      `${variant.source}/icon.json`,
      JSON.stringify(
        {
          fill: { solid: `srgb:${r!.toFixed(5)},${g!.toFixed(5)},${b!.toFixed(5)},1.00000` },
          groups: [
            {
              layers: [
                {
                  "image-name": "mark.svg",
                  name: "Spindle",
                  glass: true,
                  position: { scale: 1, "translation-in-points": [0, 0] },
                },
              ],
              shadow: { kind: "neutral", opacity: 0.35 },
              translucency: { enabled: true, value: 0.5 },
            },
          ],
          "supported-platforms": { circles: ["watchOS"], squares: "shared" },
        },
        null,
        2,
      ) + "\n",
    );
  }

  text("assets/prod/logo.svg", composeIconSvg(mark, BACKGROUNDS.production));
  const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432" viewBox="0 0 1024 1024"><svg x="160" y="160" width="704" height="704" viewBox="0 0 1024 1024" fill="#fff">${mark}</svg></svg>\n`;
  text("apps/mobile/assets/android-icon-foreground.svg", adaptive);
  const foreground = await render(adaptive, 432);
  generated.set("apps/mobile/assets/android-icon-foreground.png", foreground);
  generated.set("apps/mobile/assets/android-icon-mark.png", foreground);
  generated.set(
    "apps/mobile/assets/android-notification-icon.png",
    await render(transparent("#fff"), 96),
  );

  for (const override of [
    ...DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
    ...resolveWebIconOverrides("production", "apps/marketing/public"),
  ]) {
    generated.set(override.targetRelativePath, generated.get(override.sourceRelativePath)!);
  }
  for (const [target, sourcePath] of [
    ["apps/marketing/src/assets/icon.webp", BRAND_ASSET_PATHS.productionLinuxIconPng],
    ["apps/marketing/src/assets/icon-nightly.webp", BRAND_ASSET_PATHS.nightlyLinuxIconPng],
  ] as const) {
    generated.set(
      target,
      await sharp(generated.get(sourcePath)!).webp({ lossless: true }).toBuffer(),
    );
  }

  const stale: string[] = [];
  for (const [target, contents] of generated) {
    const destination = NodePath.join(REPOSITORY_ROOT, target);
    if (checkOnly) {
      const existing = await NodeFSP.readFile(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const matches =
        existing &&
        (target.endsWith(".json")
          ? JSON.stringify(JSON.parse(existing.toString())) ===
            JSON.stringify(JSON.parse(contents.toString()))
          : existing.equals(contents));
      if (!matches) stale.push(target);
    } else {
      await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
      await NodeFSP.writeFile(destination, contents);
    }
  }
  if (stale.length > 0) throw new Error(`Generated Spindle assets are stale:\n${stale.join("\n")}`);
  console.log(`${checkOnly ? "Verified" : "Updated"} ${generated.size} Spindle brand assets.`);
}

if (import.meta.main) {
  if (process.argv.slice(2).some((argument) => argument !== "--check")) {
    throw new Error("Usage: node scripts/export-brand-icons.ts [--check]");
  }
  await exportBrandIcons(process.argv.includes("--check"));
}

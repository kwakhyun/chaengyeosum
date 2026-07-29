import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDir = join(
  projectRoot,
  "submission-assets",
  "2026-07-29-final",
);
const sourceDir = join(packageDir, "source");
const outputDir = join(packageDir, "exports");

mkdirSync(outputDir, { recursive: true });

const inputs = {
  lightLogo: join(sourceDir, "logo-light-generated.png"),
  darkLogo: join(
    projectRoot,
    "submission-assets",
    "final",
    "logo-dark-600x600.png",
  ),
  home: join(sourceDir, "01-home-480x791.png"),
  places: join(sourceDir, "02-places-480x791.png"),
  personality: join(sourceDir, "03-personality-result-480x791.png"),
  create: join(sourceDir, "04-create-step-480x791.png"),
};

const outputs = [
  {
    input: inputs.lightLogo,
    filename: "app-logo-light-600x600.png",
    kind: "app-logo-light",
    width: 600,
    height: 600,
  },
  {
    input: inputs.darkLogo,
    filename: "app-logo-dark-600x600.png",
    kind: "app-logo-dark",
    width: 600,
    height: 600,
  },
  {
    input: inputs.home,
    filename: "screenshot-01-home-636x1048.png",
    kind: "screenshot-vertical",
    width: 636,
    height: 1048,
  },
  {
    input: inputs.places,
    filename: "screenshot-02-places-weather-636x1048.png",
    kind: "screenshot-vertical",
    width: 636,
    height: 1048,
  },
  {
    input: inputs.personality,
    filename: "screenshot-03-personality-result-636x1048.png",
    kind: "screenshot-vertical",
    width: 636,
    height: 1048,
  },
  {
    input: inputs.create,
    filename: "screenshot-04-create-outing-636x1048.png",
    kind: "screenshot-vertical",
    width: 636,
    height: 1048,
  },
];

for (const asset of outputs) {
  await sharp(asset.input)
    .resize(asset.width, asset.height, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toFile(join(outputDir, asset.filename));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const files = [];
for (const asset of outputs) {
  const outputPath = join(outputDir, asset.filename);
  const metadata = await sharp(outputPath).metadata();
  files.push({
    filename: asset.filename,
    kind: asset.kind,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasAlpha: metadata.hasAlpha,
    source: relative(packageDir, asset.input),
    sha256: sha256(outputPath),
  });
}

writeFileSync(
  join(outputDir, "asset-manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      appName: "챙겨썸",
      appId: "chaengyeosum",
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      outputDir,
      files: files.map(({ filename, width, height, hasAlpha }) => ({
        filename,
        width,
        height,
        hasAlpha,
      })),
    },
    null,
    2,
  ),
);

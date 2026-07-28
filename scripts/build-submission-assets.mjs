import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(projectRoot, "submission-assets", "source");
const auditDir = join(projectRoot, "submission-assets", "audit-current");
const outputDir = join(projectRoot, "submission-assets", "final");

const paths = {
  darkMaster: join(sourceDir, "logo-dark-master.png"),
  home: join(auditDir, "01-home-636.jpg"),
  create: join(auditDir, "02-create-636.jpg"),
  detail: join(auditDir, "03-detail-636.jpg"),
  logoLight: join(outputDir, "logo-light-600x600.png"),
  logoDark: join(outputDir, "logo-dark-600x600.png"),
  screenshotHome: join(outputDir, "screenshot-vertical-01-home-636x1048.png"),
  screenshotCreate: join(
    outputDir,
    "screenshot-vertical-02-create-636x1048.png",
  ),
  screenshotDetail: join(
    outputDir,
    "screenshot-vertical-03-smart-packing-636x1048.png",
  ),
  screenshotHorizontal: join(
    outputDir,
    "screenshot-horizontal-1504x741.png",
  ),
  thumbnail: join(outputDir, "thumbnail-1932x828.png"),
};

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function textSvg({
  width,
  height,
  lines,
  x,
  y,
  fontSize,
  lineHeight,
  color,
  weight = 800,
  letterSpacing = -1.6,
}) {
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${xmlEscape(line)}</tspan>`,
    )
    .join("");
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text {
          font-family: "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
          font-size: ${fontSize}px;
          font-weight: ${weight};
          letter-spacing: ${letterSpacing}px;
        }
      </style>
      <text x="${x}" y="${y}" fill="${color}">${tspans}</text>
    </svg>
  `);
}

async function roundedScreenshot(input, width, height, radius = 34) {
  const screenshot = await sharp(input)
    .resize(width, height, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const mask = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/>
    </svg>
  `);
  return sharp(screenshot)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function buildLightLogo() {
  await sharp(paths.darkMaster)
    .resize(600, 600, { fit: "cover" })
    .removeAlpha()
    .modulate({ brightness: 1.18, saturation: 0.92 })
    .linear(1.03, 8)
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.logoLight);
}

async function buildLogos() {
  await buildLightLogo();
  await sharp(paths.darkMaster)
    .resize(600, 600, { fit: "cover" })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.logoDark);
}

async function buildVerticalScreenshots() {
  await sharp(paths.home)
    .resize(636, 1048, { fit: "cover", position: "top" })
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.screenshotHome);
  await sharp(paths.create)
    .resize(636, 1048, { fit: "cover", position: "top" })
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.screenshotCreate);
  await sharp(paths.detail)
    .extract({ left: 0, top: 285, width: 320, height: 527 })
    .resize(636, 1048, { fit: "fill" })
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.screenshotDetail);
}

async function buildHorizontalScreenshot() {
  const home = await roundedScreenshot(paths.screenshotHome, 310, 511, 28);
  const detail = await roundedScreenshot(paths.screenshotDetail, 350, 577, 30);
  const logo = await sharp(paths.logoLight).resize(148, 148).png().toBuffer();
  const background = Buffer.from(`
    <svg width="1504" height="741" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F5FAFF"/>
          <stop offset="1" stop-color="#DDEEFF"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1B64DA" flood-opacity=".18"/>
        </filter>
      </defs>
      <rect width="1504" height="741" fill="url(#bg)"/>
      <circle cx="1390" cy="36" r="310" fill="#C9E2FF" opacity=".7"/>
      <circle cx="1120" cy="690" r="290" fill="#FFFFFF" opacity=".55"/>
      <rect x="835" y="111" width="330" height="531" rx="34" fill="#fff" filter="url(#shadow)"/>
      <rect x="1112" y="62" width="370" height="597" rx="36" fill="#fff" filter="url(#shadow)"/>
    </svg>
  `);
  const headline = textSvg({
    width: 1504,
    height: 741,
    lines: ["날씨에 맞게,", "친구들과 나눠 챙겨요"],
    x: 96,
    y: 345,
    fontSize: 58,
    lineHeight: 76,
    color: "#191F28",
    letterSpacing: -3,
  });
  const body = textSvg({
    width: 1504,
    height: 741,
    lines: ["모임을 만들면 준비물과 담당자가 한눈에 보여요"],
    x: 98,
    y: 489,
    fontSize: 24,
    lineHeight: 34,
    color: "#4E5968",
    weight: 600,
    letterSpacing: -0.9,
  });

  await sharp(background)
    .composite([
      { input: logo, left: 96, top: 84 },
      { input: headline, left: 0, top: 0 },
      { input: body, left: 0, top: 0 },
      { input: home, left: 845, top: 121 },
      { input: detail, left: 1122, top: 72 },
    ])
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.screenshotHorizontal);
}

async function buildThumbnail() {
  const detail = await roundedScreenshot(paths.screenshotDetail, 410, 676, 36);
  const create = await roundedScreenshot(paths.screenshotCreate, 370, 610, 34);
  const logo = await sharp(paths.logoLight).resize(164, 164).png().toBuffer();
  const background = Buffer.from(`
    <svg width="1932" height="828" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FFFFFF"/>
          <stop offset=".55" stop-color="#EAF4FF"/>
          <stop offset="1" stop-color="#C9E2FF"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#1957C2" flood-opacity=".2"/>
        </filter>
      </defs>
      <rect width="1932" height="828" fill="url(#bg)"/>
      <circle cx="1790" cy="30" r="360" fill="#90C2FF" opacity=".25"/>
      <circle cx="1430" cy="780" r="390" fill="#FFFFFF" opacity=".5"/>
      <rect x="1180" y="98" width="390" height="630" rx="38" fill="#fff" filter="url(#shadow)"/>
      <rect x="1460" y="48" width="430" height="696" rx="40" fill="#fff" filter="url(#shadow)"/>
    </svg>
  `);
  const headline = textSvg({
    width: 1932,
    height: 828,
    lines: ["이번 여름 약속,", "친구들과 같이 챙겨요"],
    x: 118,
    y: 384,
    fontSize: 68,
    lineHeight: 88,
    color: "#191F28",
    letterSpacing: -3.5,
  });
  const body = textSvg({
    width: 1932,
    height: 828,
    lines: ["날씨 맞춤 준비물부터 담당 나누기까지"],
    x: 121,
    y: 561,
    fontSize: 28,
    lineHeight: 40,
    color: "#4E5968",
    weight: 650,
    letterSpacing: -1.1,
  });

  await sharp(background)
    .composite([
      { input: logo, left: 118, top: 86 },
      { input: headline, left: 0, top: 0 },
      { input: body, left: 0, top: 0 },
      { input: create, left: 1190, top: 108 },
      { input: detail, left: 1470, top: 58 },
    ])
    .png({ compressionLevel: 9, palette: false })
    .toFile(paths.thumbnail);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeManifest() {
  const files = [
    {
      path: paths.logoLight,
      kind: "app-logo-light",
      width: 600,
      height: 600,
    },
    {
      path: paths.logoDark,
      kind: "app-logo-dark",
      width: 600,
      height: 600,
    },
    {
      path: paths.screenshotHome,
      kind: "screenshot-vertical",
      width: 636,
      height: 1048,
    },
    {
      path: paths.screenshotCreate,
      kind: "screenshot-vertical",
      width: 636,
      height: 1048,
    },
    {
      path: paths.screenshotDetail,
      kind: "screenshot-vertical",
      width: 636,
      height: 1048,
    },
    {
      path: paths.screenshotHorizontal,
      kind: "screenshot-horizontal",
      width: 1504,
      height: 741,
    },
    {
      path: paths.thumbnail,
      kind: "thumbnail",
      width: 1932,
      height: 828,
    },
  ].map((file) => ({
    ...file,
    filename: file.path.split("/").at(-1),
    sha256: sha256(file.path),
  }));

  writeFileSync(
    join(outputDir, "asset-manifest.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        appName: "chaengyeosum",
        displayName: "챙겨썸",
        files,
        sources: {
          logoLight: "submission-assets/source/logo-dark-master.png (light color grade)",
          logoDark: "submission-assets/source/logo-dark-master.png",
          screenshots: "in-app browser captures from the local app",
        },
      },
      null,
      2,
    )}\n`,
  );
}

await buildLogos();
await buildVerticalScreenshots();
await buildHorizontalScreenshot();
await buildThumbnail();
writeManifest();

console.log(
  "Built submission assets:",
  Object.values(paths).filter((path) => path.startsWith(outputDir)),
);

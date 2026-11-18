import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Sharp } from "sharp";

// Every uploaded photo is re-encoded before it's stored:
// - fits inside 1600 x 1600 (never enlarged), which is plenty for chip photos
//   and keeps a 10 MB phone photo to roughly 200-400 KB on the volume;
// - turned the right way up from the EXIF orientation;
// - all metadata dropped, including GPS, so a photo never leaks where it was taken;
// - JPEG, or WebP when the image has transparency (logos, cut-out chips).
//
// Compression must never be the reason an upload fails. If sharp can't load,
// can't read a file, or runs out of time, the original is stored exactly as it
// was before compression existed.
const MAX_SIDE = 1600;
const JPEG_QUALITY = 80;
const WEBP_QUALITY = 80;

type SharpFactory = typeof import("sharp");
let sharpLoad: Promise<SharpFactory | null> | undefined;

// Loaded on first use, not at startup: a missing or wrong native binary must
// not stop the server from booting.
function loadSharp(): Promise<SharpFactory | null> {
  sharpLoad ??= import("sharp")
    .then((m) => {
      const sharp = (m.default ?? m) as SharpFactory;
      sharp.cache(false); // don't hold decoded images between requests
      return sharp;
    })
    .catch((err) => {
      console.warn("[uploads] sharp unavailable, storing images uncompressed:", err?.message ?? err);
      return null;
    });
  return sharpLoad;
}

async function encode(sharp: SharpFactory, input: Buffer): Promise<{ data: Buffer; ext: string }> {
  // failOn "none": accept slightly truncated JPEGs that browsers still show.
  const image = (): Sharp => sharp(input, { failOn: "none" });
  const { hasAlpha } = await image().metadata();
  const pipeline = image()
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  if (hasAlpha) return { data: await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer(), ext: ".webp" };
  return { data: await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer(), ext: ".jpg" };
}

// The prebuilt sharp can't decode HEIC (HEVC licensing), so iPhone photos that
// arrive as HEIC are converted to JPEG in pure JS first. Slower, but rare:
// the mobile app already sends JPEG, and Safari converts HEIC on upload.
async function heicToJpeg(input: Buffer): Promise<Buffer> {
  const { default: convert } = await import("heic-convert");
  return Buffer.from(await convert({ buffer: input, format: "JPEG", quality: 0.92 }));
}

async function compress(input: Buffer): Promise<{ data: Buffer; ext: string } | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await encode(sharp, input);
  } catch {
    try {
      return await encode(sharp, await heicToJpeg(input));
    } catch {
      return null;
    }
  }
}

function timeout(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, ms)).unref());
}

/**
 * Stores the upload at `inputPath` in `outDir` and returns its file name.
 * Compressed when possible; otherwise the original bytes under `fallbackExt`.
 * Gives up on compressing after `budgetMs` and keeps the original.
 */
export async function storeImage(inputPath: string, outDir: string, fallbackExt: string, budgetMs: number): Promise<string> {
  const input = await fs.promises.readFile(inputPath);
  const result = budgetMs > 0 ? await Promise.race([compress(input), timeout(budgetMs)]) : null;
  if (!result) console.warn(`[uploads] stored ${path.basename(inputPath)} uncompressed`);
  const { data, ext } = result ?? { data: input, ext: fallbackExt };
  const name = crypto.randomBytes(16).toString("hex") + ext;
  await fs.promises.writeFile(path.join(outDir, name), data);
  return name;
}

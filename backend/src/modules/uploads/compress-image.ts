import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";

// Every uploaded photo is re-encoded before it's stored:
// - fits inside 1600 x 1600 (never enlarged), which is plenty for chip photos
//   and keeps a 10 MB phone photo to roughly 200-400 KB on the volume;
// - turned the right way up from the EXIF orientation;
// - all metadata dropped, including GPS, so a photo never leaks where it was taken;
// - JPEG, or WebP when the image has transparency (logos, cut-out chips).
const MAX_SIDE = 1600;
const JPEG_QUALITY = 80;
const WEBP_QUALITY = 80;

export class InvalidImageError extends Error {
  constructor() {
    super("That file isn't an image we can read");
  }
}

async function encode(input: Buffer): Promise<{ data: Buffer; ext: string }> {
  const { hasAlpha } = await sharp(input).metadata();
  const pipeline = sharp(input, { failOn: "error" })
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

/** Re-encodes `inputPath` into `outDir` and returns the new file name. The input is left in place. */
export async function compressImage(inputPath: string, outDir: string): Promise<string> {
  const input = await fs.promises.readFile(inputPath);
  let result: { data: Buffer; ext: string };
  try {
    result = await encode(input);
  } catch {
    try {
      result = await encode(await heicToJpeg(input));
    } catch {
      throw new InvalidImageError();
    }
  }
  const name = crypto.randomBytes(16).toString("hex") + result.ext;
  await fs.promises.writeFile(path.join(outDir, name), result.data);
  return name;
}

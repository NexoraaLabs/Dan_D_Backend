import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { badRequest } from "../../utils/httpError";
import { env } from "../../config/env";
import { storeImage } from "./compress-image";

export const uploadsRouter = Router();

export const uploadDir = path.resolve(env.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

// Originals land here first and are deleted once compressed, so only the
// re-encoded copies ever reach the public uploads folder.
const incomingDir = path.join(os.tmpdir(), "dand-uploads");
fs.mkdirSync(incomingDir, { recursive: true });

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg", // non-standard, but some Android pickers send it
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/heic-sequence": ".heic",
  "image/heif-sequence": ".heif",
};

const EXT_FROM_NAME: Record<string, string> = {
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".png": ".png",
  ".webp": ".webp",
  ".heic": ".heic",
  ".heif": ".heif",
};

// Mobile HTTP clients (Flutter http/dio MultipartFile.fromFile, React Native
// FormData without `type`) often send camera/gallery files as
// application/octet-stream or with no content type at all. Fall back to the
// file name's extension so those uploads aren't rejected.
function resolveExtension(file: Express.Multer.File): string | undefined {
  const byMime = EXTENSIONS[(file.mimetype || "").toLowerCase()];
  if (byMime) return byMime;
  return EXT_FROM_NAME[path.extname(file.originalname || "").toLowerCase()];
}

const MAX_FILES = 10;
const MAX_FILE_MB = 20; // modern phone camera photos are often 8–15 MB

// Local disk for now (a Railway Volume in production). Swapping in S3 /
// Cloudinary / Supabase Storage only changes where storeImage writes and the URL below.
const upload = multer({
  storage: multer.diskStorage({
    destination: incomingDir,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + resolveExtension(file)),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (resolveExtension(file)) cb(null, true);
    else cb(badRequest(`Only JPEG, PNG, WebP or HEIC images can be uploaded (got ${file.mimetype || "unknown type"})`));
  },
});

// Accept `files` (documented) and also `file` / `files[]` / `image` / `images`,
// which mobile clients commonly use; anything else gets a clear 400.
const ACCEPTED_FIELDS = new Set(["files", "files[]", "file", "image", "images", "images[]"]);
const uploadAny = upload.any();

// The mobile app gives up on an upload after 60 s (including the transfer), so
// compression across all files in one request stops after this; anything left
// is stored as the original.
const COMPRESS_BUDGET_MS = 25_000;

// Everything after auth, exported so it can be exercised without a database.
export const handleUpload = [
  uploadAny,
  asyncHandler(async (req, res) => {
    const all = (req.files as Express.Multer.File[] | undefined) ?? [];
    const files = all.filter((f) => ACCEPTED_FIELDS.has(f.fieldname));
    const saved: string[] = [];
    try {
      if (files.length === 0) {
        const got = all.map((f) => f.fieldname).join(", ");
        throw badRequest(`Attach at least one image as multipart field \`files\`${got ? ` (received: ${got})` : ""}`);
      }
      const deadline = Date.now() + COMPRESS_BUDGET_MS;
      // One at a time: decoding several 20 MB photos at once can spike memory.
      for (const f of files) {
        saved.push(await storeImage(f.path, uploadDir, path.extname(f.filename), deadline - Date.now()));
      }
    } catch (err) {
      await Promise.all(saved.map((name) => fs.promises.unlink(path.join(uploadDir, name)).catch(() => undefined)));
      throw err;
    } finally {
      await Promise.all(all.map((f) => fs.promises.unlink(f.path).catch(() => undefined)));
    }
    const base = env.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
    res.status(201).json({ urls: saved.map((name) => `${base}/uploads/${name}`) });
  }),
];

// Screens: Add Item (camera / upload), Edit Profile avatar, chat attachments, Help & Feedback.
// multipart/form-data with one or more `files` parts; the returned URLs go into
// imageUrls / avatarUrl / attachmentUrl on the follow-up request.
uploadsRouter.post("/", requireAuth, ...handleUpload);

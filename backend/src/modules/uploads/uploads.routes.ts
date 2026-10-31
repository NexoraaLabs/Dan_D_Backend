import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { badRequest } from "../../utils/httpError";
import { env } from "../../config/env";

export const uploadsRouter = Router();

export const uploadDir = path.resolve(env.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const MAX_FILES = 10;

// Local disk for now (a Railway Volume in production). Swapping in S3 /
// Cloudinary / Supabase Storage only changes this storage engine and the URL below.
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + EXTENSIONS[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (EXTENSIONS[file.mimetype]) cb(null, true);
    else cb(badRequest("Only JPEG, PNG, WebP or HEIC images can be uploaded"));
  },
});

// Screens: Add Item (camera / upload), Edit Profile avatar, chat attachments, Help & Feedback.
// multipart/form-data with one or more `files` parts; the returned URLs go into
// imageUrls / avatarUrl / attachmentUrl on the follow-up request.
uploadsRouter.post(
  "/",
  requireAuth,
  upload.array("files", MAX_FILES),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw badRequest("Attach at least one image as `files`");
    const base = env.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
    res.status(201).json({ urls: files.map((f) => `${base}/uploads/${f.filename}`) });
  })
);

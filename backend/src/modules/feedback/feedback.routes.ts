import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";

export const feedbackRouter = Router();

const feedbackSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  imageUrls: z.array(z.string().url()).max(10).default([]),
});

// Screens: Help & Feedback -> Thank You - Feedback. Images go through POST /api/uploads first.
feedbackRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = feedbackSchema.parse(req.body);
    const feedback = await prisma.feedback.create({ data: { ...input, userId: req.userId! } });
    res.status(201).json(feedback);
  })
);

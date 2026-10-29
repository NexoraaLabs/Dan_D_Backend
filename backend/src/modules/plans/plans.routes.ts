import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";

export const plansRouter = Router();

// Screen: Choose Your Plan
plansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    // Only what new subscribers can pick; inactive and admin-deleted plans are hidden.
    const plans = await prisma.plan.findMany({ where: { active: true, archivedAt: null }, orderBy: { priceCents: "asc" } });
    res.json(plans);
  })
);

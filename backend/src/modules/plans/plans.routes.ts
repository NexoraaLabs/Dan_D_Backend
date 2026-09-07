import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";

export const plansRouter = Router();

// Screen: Choose Your Plan
plansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({ orderBy: { priceCents: "asc" } });
    res.json(plans);
  })
);

import { Router } from "express";
import { PromotionType } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";

export const promotionsRouter = Router();

const querySchema = z.object({ type: z.nativeEnum(PromotionType).optional() });

// Screen: Home -- the promotional ad carousel. Only placements running right now.
promotionsRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    const { type } = querySchema.parse(req.query);
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: { status: "ACTIVE", type, startsAt: { lte: now }, endsAt: { gt: now }, user: { status: "ACTIVE" } },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        imageUrl: true,
        linkUrl: true,
        listingId: true,
        endsAt: true,
        user: { select: { id: true, username: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { startsAt: "desc" },
      take: 20,
    });
    res.json(promotions);
  })
);

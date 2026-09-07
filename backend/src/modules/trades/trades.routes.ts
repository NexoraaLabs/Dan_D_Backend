import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";
import * as tradesService from "./trades.service";

export const tradesRouter = Router();

// Screen: Trade Matches
tradesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const trades = await prisma.tradeRequest.findMany({
      where: { OR: [{ initiatorId: req.userId! }, { recipientId: req.userId! }] },
      include: { offerItems: { include: { item: { include: { images: true } } } }, initiator: true, recipient: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(trades);
  })
);

tradesRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const trade = await prisma.tradeRequest.findUnique({
      where: { id: Number(req.params.id) },
      include: { offerItems: { include: { item: { include: { images: true } } } }, initiator: true, recipient: true },
    });
    if (!trade) throw notFound("Trade request not found");
    if (trade.initiatorId !== req.userId && trade.recipientId !== req.userId) throw forbidden();
    res.json(trade);
  })
);

const proposeSchema = z.object({
  recipientId: z.number().int(),
  message: z.string().optional(),
  offerItems: z.array(z.object({ itemId: z.number().int(), side: z.enum(["GIVE", "GET"]) })).min(1),
});

// Screens: Propose Trade -> Add to Trade -> Review & Confirm -> Trade Offer Sent
tradesRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = proposeSchema.parse(req.body);
    const trade = await tradesService.proposeTrade({ initiatorId: req.userId!, ...input });
    res.status(201).json(trade);
  })
);

const respondSchema = z.object({ accept: z.boolean() });

// Screens: Trade Confirmed / Trade Rejected
tradesRouter.post(
  "/:id/respond",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { accept } = respondSchema.parse(req.body);
    const trade = await tradesService.respondToTrade(Number(req.params.id), req.userId!, accept);
    res.json(trade);
  })
);

tradesRouter.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const trade = await tradesService.cancelTrade(Number(req.params.id), req.userId!);
    res.json(trade);
  })
);

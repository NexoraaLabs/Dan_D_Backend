import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import * as auctionsService from "./auctions.service";

export const auctionsRouter = Router();

auctionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const auction = await prisma.auction.findUnique({
      where: { id: Number(req.params.id) },
      include: { listing: { include: { item: { include: { images: true } } } }, bids: { orderBy: { amountCents: "desc" }, take: 20, include: { bidder: { select: { id: true, username: true } } } } },
    });
    if (!auction) throw notFound("Auction not found");
    res.json(auction);
  })
);

const bidSchema = z.object({ amountCents: z.number().int().positive() });

// Screens: Place Your Bid, Place Your Bid - $110/+10/+25, Bid Placed
auctionsRouter.post(
  "/:id/bids",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { amountCents } = bidSchema.parse(req.body);
    const bid = await auctionsService.placeBid(Number(req.params.id), req.userId!, amountCents);
    res.status(201).json(bid);
  })
);

// Screens: Auction Winner / Auction Lost
auctionsRouter.post(
  "/:id/close",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.auction.findUnique({ where: { id }, include: { listing: true } });
    if (!existing) throw notFound("Auction not found");
    // Without these checks any user could end any auction early and lock in the current top bid.
    if (existing.listing.sellerId !== req.userId) throw forbidden("Only the seller can close this auction");
    if (existing.endsAt > new Date()) throw badRequest("Auction hasn't ended yet");
    const auction = await auctionsService.closeAuction(id);
    res.json(auction);
  })
);

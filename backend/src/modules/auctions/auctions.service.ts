import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";

// Screens: Auction Detail -> Place Your Bid (-$110/+10/+25) -> Bid Placed -> Auction Winner/Lost
export async function placeBid(auctionId: number, bidderId: number, amountCents: number) {
  return prisma.$transaction(async (tx) => {
    const auction = await tx.auction.findUnique({ where: { id: auctionId }, include: { listing: true } });
    if (!auction) throw notFound("Auction not found");
    if (auction.listing.sellerId === bidderId) throw forbidden("Sellers can't bid on their own auction");
    const now = new Date();
    if (auction.endsAt < now) throw badRequest("Auction has already ended");
    // The scheduler flips SCHEDULED -> LIVE once a minute; don't make the first bidder wait for it.
    const liveNow = auction.status === "SCHEDULED" && auction.startsAt <= now;
    if (auction.status !== "LIVE" && !liveNow) throw badRequest("Auction is not currently live");
    if (liveNow) await tx.auction.update({ where: { id: auctionId }, data: { status: "LIVE" } });

    const minAcceptable = auction.currentPriceCents + auction.bidIncrementCents;
    if (amountCents < minAcceptable) {
      throw badRequest(`Bid must be at least ${minAcceptable} cents (current + increment)`);
    }

    const previousHighBid = await tx.bid.findFirst({
      where: { auctionId },
      orderBy: { amountCents: "desc" },
    });

    const bid = await tx.bid.create({ data: { auctionId, bidderId, amountCents } });
    await tx.auction.update({ where: { id: auctionId }, data: { currentPriceCents: amountCents } });

    if (previousHighBid && previousHighBid.bidderId !== bidderId) {
      await createNotification(tx, {
        userId: previousHighBid.bidderId,
        type: "bid_outbid",
        title: "You've been outbid",
        body: `Someone placed a higher bid on ${auction.listing.itemId ? "an item you're bidding on" : "an auction"}.`,
        data: { auctionId },
      });
    }

    return bid;
  });
}

// Called by the auction scheduler once `endsAt` passes, and by the seller's
// close endpoint (which checks ownership and the end time first).
export async function closeAuction(auctionId: number) {
  return prisma.$transaction(async (tx) => {
    const auction = await tx.auction.findUnique({ where: { id: auctionId } });
    if (!auction) throw notFound("Auction not found");
    if (auction.status === "ENDED") return auction;

    const topBid = await tx.bid.findFirst({ where: { auctionId }, orderBy: { amountCents: "desc" } });

    const updated = await tx.auction.update({
      where: { id: auctionId },
      data: { status: "ENDED", winnerId: topBid?.bidderId },
    });

    if (topBid) {
      await createNotification(tx, {
        userId: topBid.bidderId,
        type: "auction_won",
        title: "You won the auction!",
        body: "Complete checkout to claim your item.",
        data: { auctionId },
      });
      await tx.marketplaceListing.update({ where: { id: auction.listingId }, data: { status: "SOLD" } });
    }

    return updated;
  });
}

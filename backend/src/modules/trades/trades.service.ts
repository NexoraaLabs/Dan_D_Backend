import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";

interface OfferItemInput {
  itemId: number;
  side: "GIVE" | "GET"; // GIVE = initiator's item offered; GET = recipient's item requested
}

// Screens: Propose Trade (1-5) -> Add to Trade -> Review & Confirm -> Trade Offer Sent
export async function proposeTrade(input: {
  initiatorId: number;
  recipientId: number;
  message?: string;
  offerItems: OfferItemInput[];
}) {
  if (input.initiatorId === input.recipientId) throw badRequest("Can't propose a trade with yourself");
  if (input.offerItems.length === 0) throw badRequest("At least one item is required");

  const itemIds = input.offerItems.map((o) => o.itemId);
  const items = await prisma.item.findMany({ where: { id: { in: itemIds } } });
  if (items.length !== itemIds.length) throw notFound("One or more items not found");

  for (const offer of input.offerItems) {
    const item = items.find((i) => i.id === offer.itemId)!;
    const expectedOwner = offer.side === "GIVE" ? input.initiatorId : input.recipientId;
    if (item.ownerId !== expectedOwner) {
      throw badRequest(`Item ${item.id} is not owned by the expected party for a "${offer.side}" offer`);
    }
  }

  const trade = await prisma.tradeRequest.create({
    data: {
      initiatorId: input.initiatorId,
      recipientId: input.recipientId,
      message: input.message,
      offerItems: {
        create: input.offerItems.map((o) => ({
          itemId: o.itemId,
          side: o.side,
          ownerId: o.side === "GIVE" ? input.initiatorId : input.recipientId,
        })),
      },
    },
    include: { offerItems: { include: { item: true } } },
  });

  await createNotification(prisma, {
    userId: input.recipientId,
    type: "trade_request",
    title: "New trade proposal",
    body: "Someone wants to trade with you.",
    data: { tradeRequestId: trade.id },
  });

  return trade;
}

// Screens: Trade Offer Completed / Trade Confirmed / Trade Rejected
export async function respondToTrade(tradeRequestId: number, userId: number, accept: boolean) {
  return prisma.$transaction(async (tx) => {
    const trade = await tx.tradeRequest.findUnique({ where: { id: tradeRequestId }, include: { offerItems: true } });
    if (!trade) throw notFound("Trade request not found");
    if (trade.recipientId !== userId) throw forbidden("Only the recipient can respond to this trade");
    if (trade.status !== "PENDING") throw badRequest("Trade request has already been responded to");

    if (!accept) {
      const updated = await tx.tradeRequest.update({
        where: { id: tradeRequestId },
        data: { status: "REJECTED", respondedAt: new Date() },
      });
      await createNotification(tx, {
        userId: trade.initiatorId,
        type: "trade_rejected",
        title: "Trade rejected",
        data: { tradeRequestId },
      });
      return updated;
    }

    // Accept: swap ownership of every offered item, then mark the trade completed.
    for (const offer of trade.offerItems) {
      const newOwnerId = offer.side === "GIVE" ? trade.recipientId : trade.initiatorId;
      await tx.item.update({ where: { id: offer.itemId }, data: { ownerId: newOwnerId, status: "HAVE" } });
    }

    const updated = await tx.tradeRequest.update({
      where: { id: tradeRequestId },
      data: { status: "COMPLETED", respondedAt: new Date() },
    });

    await createNotification(tx, {
      userId: trade.initiatorId,
      type: "trade_accepted",
      title: "Trade accepted!",
      data: { tradeRequestId },
    });

    return updated;
  });
}

export async function cancelTrade(tradeRequestId: number, userId: number) {
  const trade = await prisma.tradeRequest.findUnique({ where: { id: tradeRequestId } });
  if (!trade) throw notFound("Trade request not found");
  if (trade.initiatorId !== userId) throw forbidden("Only the initiator can cancel this trade");
  if (trade.status !== "PENDING") throw badRequest("Only a pending trade can be cancelled");
  return prisma.tradeRequest.update({ where: { id: tradeRequestId }, data: { status: "CANCELLED", respondedAt: new Date() } });
}

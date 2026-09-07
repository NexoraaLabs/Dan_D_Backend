import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";

// Screens: Shipping -> Payment - Checkout -> Order Placed -> Track Order
// NOTE: payment capture is stubbed. Wiring a real charge means picking a
// processor (Stripe for card-on-file marketplace purchases; Apple/Google IAP
// only applies to the subscription plans, not marketplace goods) and calling
// out to it here before marking the order PAID.
export async function checkout(input: {
  buyerId: number;
  listingId: number;
  shippingAddressId?: number;
  paymentMethodId?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.marketplaceListing.findUnique({ where: { id: input.listingId }, include: { item: true } });
    if (!listing) throw notFound("Listing not found");
    if (listing.status !== "ACTIVE") throw badRequest("Listing is not available for purchase");
    if (listing.listingType === "AUCTION") throw badRequest("Auction items are settled via the auction winner flow, not direct checkout");
    if (listing.sellerId === input.buyerId) throw badRequest("Can't buy your own listing");
    if (!listing.priceCents) throw badRequest("Listing has no price");

    const order = await tx.order.create({
      data: {
        listingId: listing.id,
        buyerId: input.buyerId,
        sellerId: listing.sellerId,
        totalCents: listing.priceCents,
        shippingAddressId: input.shippingAddressId,
        paymentMethodId: input.paymentMethodId,
        status: "PAID", // stubbed: treat checkout as immediately paid in dev
        items: { create: [{ itemId: listing.itemId, priceCents: listing.priceCents }] },
      },
      include: { items: true },
    });

    await tx.marketplaceListing.update({ where: { id: listing.id }, data: { status: "SOLD" } });

    await createNotification(tx, {
      userId: listing.sellerId,
      type: "order_placed",
      title: "Your item sold!",
      data: { orderId: order.id },
    });

    return order;
  });
}

const ORDER_STATUS_FLOW: Record<string, string[]> = {
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
};

// Screen: Track Order (2/3/4)
export async function advanceOrderStatus(orderId: number, sellerId: number, nextStatus: "SHIPPED" | "DELIVERED" | "CANCELLED", trackingNumber?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound("Order not found");
  if (order.sellerId !== sellerId) throw forbidden("Only the seller can update order status");

  const allowedNext = ORDER_STATUS_FLOW[order.status] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    throw badRequest(`Can't move order from ${order.status} to ${nextStatus}`);
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { status: nextStatus, trackingNumber: trackingNumber ?? order.trackingNumber },
  });

  await createNotification(prisma, {
    userId: order.buyerId,
    type: "order_status",
    title: `Order ${nextStatus.toLowerCase()}`,
    data: { orderId },
  });

  return updated;
}

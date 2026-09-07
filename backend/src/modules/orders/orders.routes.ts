import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";
import * as ordersService from "./orders.service";

export const ordersRouter = Router();

// Screens: Orders - Purchase / Orders - Trade
ordersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { OR: [{ buyerId: req.userId! }, { sellerId: req.userId! }] },
      include: { items: { include: { item: { include: { images: true } } } }, listing: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
  })
);

ordersRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { item: { include: { images: true } } } }, listing: true, shippingAddress: true },
    });
    if (!order) throw notFound("Order not found");
    if (order.buyerId !== req.userId && order.sellerId !== req.userId) throw forbidden();
    res.json(order);
  })
);

const checkoutSchema = z.object({
  listingId: z.number().int(),
  shippingAddressId: z.number().int().optional(),
  paymentMethodId: z.number().int().optional(),
});

// Screens: Shipping -> Payment - Checkout -> Order Placed
ordersRouter.post(
  "/checkout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const order = await ordersService.checkout({ buyerId: req.userId!, ...input });
    res.status(201).json(order);
  })
);

const advanceSchema = z.object({
  status: z.enum(["SHIPPED", "DELIVERED", "CANCELLED"]),
  trackingNumber: z.string().optional(),
});

// Screen: Track Order (2/3/4)
ordersRouter.post(
  "/:id/advance",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = advanceSchema.parse(req.body);
    const order = await ordersService.advanceOrderStatus(Number(req.params.id), req.userId!, input.status, input.trackingNumber);
    res.json(order);
  })
);

// --- Order Requests: buyer proposes a price before checkout ---------------

const orderRequestSchema = z.object({ listingId: z.number().int(), offerAmountCents: z.number().int().positive() });

// Screens: Order Request - Sent / Order Request - Received
ordersRouter.post(
  "/requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = orderRequestSchema.parse(req.body);
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: input.listingId } });
    if (!listing) throw notFound("Listing not found");
    if (listing.sellerId === req.userId) throw badRequest("Can't request your own listing");

    const request = await prisma.orderRequest.create({
      data: {
        listingId: listing.id,
        buyerId: req.userId!,
        sellerId: listing.sellerId,
        offerAmountCents: input.offerAmountCents,
      },
    });
    await createNotification(prisma, {
      userId: listing.sellerId,
      type: "order_request",
      title: "New offer on your listing",
      data: { orderRequestId: request.id },
    });
    res.status(201).json(request);
  })
);

ordersRouter.get(
  "/requests/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const requests = await prisma.orderRequest.findMany({
      where: { OR: [{ buyerId: req.userId! }, { sellerId: req.userId! }] },
      include: { listing: { include: { item: { include: { images: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  })
);

const respondRequestSchema = z.object({ accept: z.boolean() });

// Screens: Confirm Request -> Request Sent / Order Rejected
ordersRouter.post(
  "/requests/:id/respond",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { accept } = respondRequestSchema.parse(req.body);
    const request = await prisma.orderRequest.findUnique({ where: { id: Number(req.params.id) } });
    if (!request) throw notFound("Order request not found");
    if (request.sellerId !== req.userId) throw forbidden("Only the seller can respond to this request");
    if (request.status !== "PENDING") throw badRequest("Request has already been responded to");

    const updated = await prisma.orderRequest.update({
      where: { id: request.id },
      data: { status: accept ? "ACCEPTED" : "REJECTED", respondedAt: new Date() },
    });
    await createNotification(prisma, {
      userId: request.buyerId,
      type: accept ? "order_request_accepted" : "order_request_rejected",
      title: accept ? "Your offer was accepted" : "Your offer was declined",
      data: { orderRequestId: request.id },
    });
    res.json(updated);
  })
);


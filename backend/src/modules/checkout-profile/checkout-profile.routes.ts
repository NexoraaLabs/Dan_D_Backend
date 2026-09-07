import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";

// Shipping addresses + payment methods used by the Buy Flow (Shipping,
// Payment - Checkout) and Settings (Payment Methods, Add Card, Manage Card).

export const shippingAddressesRouter = Router();

const addressSchema = z.object({
  fullName: z.string(),
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(),
  phone: z.string().optional(),
  isDefault: z.boolean().default(false),
});

shippingAddressesRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const addresses = await prisma.shippingAddress.findMany({ where: { userId: req.userId! } });
    res.json(addresses);
  })
);

shippingAddressesRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = addressSchema.parse(req.body);
    const address = await prisma.shippingAddress.create({ data: { ...input, userId: req.userId! } });
    res.status(201).json(address);
  })
);

shippingAddressesRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.shippingAddress.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Address not found");
    if (existing.userId !== req.userId) throw forbidden();
    await prisma.shippingAddress.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

export const paymentMethodsRouter = Router();

// NOTE: this stores only the last4/brand/expiry plus an opaque `providerToken`
// (a Stripe payment-method id, in practice). Raw card numbers must never
// transit this API — the mobile app should tokenize via Stripe's SDK first.
const cardSchema = z.object({
  brand: z.string(),
  last4: z.string().length(4),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int(),
  providerToken: z.string(),
  isDefault: z.boolean().default(false),
});

// Screen: Payment Methods
paymentMethodsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const methods = await prisma.paymentMethod.findMany({ where: { userId: req.userId! } });
    res.json(methods);
  })
);

// Screens: Add Card -> Card Added
paymentMethodsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = cardSchema.parse(req.body);
    const method = await prisma.paymentMethod.create({ data: { ...input, userId: req.userId! } });
    res.status(201).json(method);
  })
);

// Screen: Manage Card
paymentMethodsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.paymentMethod.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Payment method not found");
    if (existing.userId !== req.userId) throw forbidden();
    await prisma.paymentMethod.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

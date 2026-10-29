import { Router } from "express";
import { PaymentStatus, Prisma, PromotionStatus, PromotionType } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { badRequest, notFound } from "../../utils/httpError";
import { adminUserSelect, pageArgs, pageQuerySchema, recordAudit } from "./admin.shared";

export const adminPromotionsRouter = Router();

/** Promotions are fixed 30-day placements unless an end date is given. */
export const PROMOTION_DAYS = 30;

const listQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().optional(),
  status: z.nativeEnum(PromotionStatus).optional(),
  type: z.nativeEnum(PromotionType).optional(),
  userId: z.coerce.number().int().optional(),
});

// Admin screen: Ads Promotion list (All / Active / Paused / Expired).
adminPromotionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where: Prisma.PromotionWhereInput = {
      status: q.status,
      type: q.type,
      userId: q.userId,
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search } },
              { user: { OR: [{ fullName: { contains: q.search } }, { username: { contains: q.search } }, { email: { contains: q.search } }] } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.promotion.findMany({ where, include: { user: { select: adminUserSelect } }, orderBy: { startsAt: "desc" }, ...pageArgs(q) }),
      prisma.promotion.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);

// Admin screen: Promotion Details.
adminPromotionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: Number(req.params.id) },
      include: { user: { select: adminUserSelect }, payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!promotion) throw notFound("Promotion not found");
    res.json(promotion);
  })
);

const promotionSchema = z.object({
  userId: z.number().int(),
  type: z.nativeEnum(PromotionType),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
  linkUrl: z.string().url().optional(),
  listingId: z.number().int().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  feeCents: z.number().int().min(0),
  paymentStatus: z.nativeEnum(PaymentStatus).default("PENDING"),
  status: z.nativeEnum(PromotionStatus).default("ACTIVE"),
});

/** Shared checks for create and edit: the user exists, a LISTING promotion points at their own listing, dates are ordered. */
async function validatePromotion(input: { userId: number; type: PromotionType; listingId?: number | null; startsAt: Date; endsAt: Date }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) throw badRequest("User not found");
  if (input.type === "LISTING") {
    if (!input.listingId) throw badRequest("listingId is required for a LISTING promotion");
    const listing = await prisma.marketplaceListing.findUnique({ where: { id: input.listingId }, select: { sellerId: true } });
    if (!listing || listing.sellerId !== input.userId) throw badRequest("Listing not found for this user");
  }
  if (input.endsAt <= input.startsAt) throw badRequest("endsAt must be after startsAt");
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

// Admin screen: Create Promotion.
adminPromotionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = promotionSchema.parse(req.body);
    const endsAt = input.endsAt ?? addDays(input.startsAt, PROMOTION_DAYS);
    await validatePromotion({ ...input, endsAt });
    const promotion = await prisma.promotion.create({ data: { ...input, endsAt } });
    res.status(201).json(promotion);
  })
);

// Admin screen: Edit Promotion.
adminPromotionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = promotionSchema.partial().parse(req.body);
    const existing = await prisma.promotion.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Promotion not found");
    const merged = { ...existing, ...input };
    // Moving the start without a new end keeps the placement 30 days long.
    const endsAt = input.endsAt ?? (input.startsAt ? addDays(input.startsAt, PROMOTION_DAYS) : existing.endsAt);
    await validatePromotion({ ...merged, endsAt });
    const promotion = await prisma.promotion.update({ where: { id: existing.id }, data: { ...input, endsAt } });
    res.json(promotion);
  })
);

const reasonSchema = z.object({ reason: z.string().trim().max(2000).optional() });

// Admin dialog: "Cancel this promotion?" -- stops showing at once; no automatic refund.
adminPromotionsRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const { reason } = reasonSchema.parse(req.body ?? {});
    const existing = await prisma.promotion.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Promotion not found");
    if (existing.status !== "ACTIVE" && existing.status !== "PAUSED") throw badRequest("Only active or paused promotions can be cancelled");
    const promotion = await prisma.$transaction(async (tx) => {
      await recordAudit(tx, { actorId: req.userId!, action: "promotion.cancel", targetType: "promotion", targetId: existing.id, reason });
      return tx.promotion.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
    });
    res.json(promotion);
  })
);

// Admin dialog: "Delete this promotion?" -- removed permanently. Payment rows are
// kept for the books and just lose the link.
adminPromotionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.promotion.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Promotion not found");
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { promotionId: existing.id }, data: { promotionId: null } });
      await tx.promotion.delete({ where: { id: existing.id } });
      await recordAudit(tx, {
        actorId: req.userId!,
        action: "promotion.delete",
        targetType: "promotion",
        targetId: existing.id,
        data: { title: existing.title, userId: existing.userId },
      });
    });
    res.status(204).send();
  })
);

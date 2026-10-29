import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { recordAudit } from "./admin.shared";

export const adminPlansRouter = Router();

// Plans the signup flow depends on can't be deleted.
const PROTECTED_CODES = new Set(["FREE"]);

async function withSubscriberCounts<T extends { id: number }>(plans: T[]) {
  const counts = await prisma.subscription.groupBy({
    by: ["planId"],
    where: { status: "ACTIVE", planId: { in: plans.map((p) => p.id) } },
    _count: { _all: true },
  });
  const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
  return plans.map((plan) => ({ ...plan, subscriberCount: byPlan.get(plan.id) ?? 0 }));
}

// Admin screen: Subscriptions -> Plans tab (inactive plans included; deleted ones only on request).
adminPlansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    const plans = await prisma.plan.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { priceCents: "asc" },
    });
    res.json(await withSubscriberCounts(plans));
  })
);

adminPlansRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const plan = await prisma.plan.findUnique({ where: { id: Number(req.params.id) } });
    if (!plan) throw notFound("Plan not found");
    const [withCount] = await withSubscriberCounts([plan]);
    res.json(withCount);
  })
);

const planSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9_]+$/, "Use capital letters, digits and underscores, e.g. GOLD_PLUS"),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(2000).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  priceCents: z.number().int().min(0),
  billingPeriod: z.enum(["month", "year", "trial_15d"]),
  itemLimit: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
  recommended: z.boolean().default(false),
  autoRenewDefault: z.boolean().default(true),
});

// Admin screen: Create Plan.
adminPlansRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = planSchema.parse(req.body);
    if (await prisma.plan.findUnique({ where: { code: input.code } })) throw conflict("A plan with this code already exists");
    const plan = await prisma.plan.create({ data: input });
    res.status(201).json({ ...plan, subscriberCount: 0 });
  })
);

// Admin screens: Edit Plan, and the Plan Settings toggles on Subscription Details.
// Price changes apply to new subscribers; existing subscriptions keep the amount they bought at.
adminPlansRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = planSchema.omit({ code: true }).partial().parse(req.body);
    const existing = await prisma.plan.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Plan not found");
    if (existing.archivedAt) throw badRequest("This plan was deleted");
    const plan = await prisma.plan.update({ where: { id: existing.id }, data: input });
    const [withCount] = await withSubscriberCounts([plan]);
    res.json(withCount);
  })
);

// Admin dialog: "Delete this plan?" -- removed from the pricing page; existing
// subscribers keep it until their next renewal, so the row is archived, not deleted.
adminPlansRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.plan.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Plan not found");
    if (PROTECTED_CODES.has(existing.code)) throw badRequest("The free trial plan is used at sign-up and can't be deleted");
    await prisma.$transaction(async (tx) => {
      await tx.plan.update({ where: { id: existing.id }, data: { archivedAt: new Date(), active: false } });
      await recordAudit(tx, { actorId: req.userId!, action: "plan.delete", targetType: "plan", targetId: existing.id });
    });
    res.status(204).send();
  })
);

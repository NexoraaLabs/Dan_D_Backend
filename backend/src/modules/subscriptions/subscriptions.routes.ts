import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { badRequest, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";

export const subscriptionsRouter = Router();

function periodEnd(start: Date, billingPeriod: string): Date {
  const end = new Date(start);
  if (billingPeriod === "month") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

// Screens: My Profile -> Subscription Plan, Choose Your Plan ("Current" badge).
subscriptionsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user, subscription] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: req.userId! },
        select: { plan: true, trialEndsAt: true, planExpiresAt: true, _count: { select: { items: true } } },
      }),
      prisma.subscription.findFirst({
        where: { userId: req.userId!, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    res.json({
      plan: user.plan,
      trialEndsAt: user.trialEndsAt,
      planExpiresAt: user.planExpiresAt,
      itemCount: user._count.items,
      subscription,
    });
  })
);

const subscribeSchema = z.object({
  planId: z.number().int(),
  paymentMethodId: z.number().int().optional(),
});

// Screens: Choose Your Plan -> Payment (blue flow) -> Subscribed.
// NOTE: the charge is stubbed, like order checkout. In the store builds this
// must be replaced by Apple/Google IAP receipt validation -- the stores don't
// allow card payments for in-app subscriptions.
subscriptionsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = subscribeSchema.parse(req.body);
    const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.active || plan.archivedAt) throw notFound("Plan not available");
    if (plan.billingPeriod === "trial_15d") throw badRequest("The free trial starts automatically when you sign up");

    let method: string | undefined;
    if (input.paymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: input.paymentMethodId } });
      if (!pm || pm.userId !== req.userId) throw notFound("Payment method not found");
      method = `${pm.brand} •••• ${pm.last4}`;
    }

    const now = new Date();
    const expiresAt = periodEnd(now, plan.billingPeriod);
    const subscription = await prisma.$transaction(async (tx) => {
      // One active subscription per user: switching plans ends the old one.
      await tx.subscription.updateMany({
        where: { userId: req.userId!, status: "ACTIVE" },
        data: { status: "CANCELLED", autoRenew: false },
      });
      const created = await tx.subscription.create({
        data: {
          userId: req.userId!,
          planId: plan.id,
          amountCents: plan.priceCents,
          billingPeriod: plan.billingPeriod,
          autoRenew: plan.autoRenewDefault,
          startedAt: now,
          renewsAt: plan.autoRenewDefault ? expiresAt : null,
          expiresAt,
          payments: {
            create: {
              userId: req.userId!,
              amountCents: plan.priceCents,
              method,
              transactionId: `stub_${crypto.randomBytes(12).toString("hex")}`,
              status: "PAID", // stubbed: treated as paid until IAP/Stripe is wired up
              paidAt: now,
            },
          },
        },
        include: { plan: true, payments: true },
      });
      await tx.user.update({ where: { id: req.userId! }, data: { planId: plan.id, planExpiresAt: expiresAt } });
      await createNotification(tx, {
        userId: req.userId!,
        type: "subscription_started",
        title: `You're subscribed to ${plan.name}`,
        data: { subscriptionId: created.id },
      });
      return created;
    });
    res.status(201).json(subscription);
  })
);

// Screen: Subscription Plan -> auto-renew toggle.
subscriptionsRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { autoRenew } = z.object({ autoRenew: z.boolean() }).parse(req.body);
    const current = await prisma.subscription.findFirst({ where: { userId: req.userId!, status: "ACTIVE" } });
    if (!current) throw notFound("No active subscription");
    const updated = await prisma.subscription.update({
      where: { id: current.id },
      data: { autoRenew, renewsAt: autoRenew ? current.expiresAt : null },
      include: { plan: true },
    });
    res.json(updated);
  })
);

// Cancelling stops renewal; the plan stays usable until expiresAt, when the scheduler ends it.
subscriptionsRouter.post(
  "/me/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = await prisma.subscription.findFirst({ where: { userId: req.userId!, status: "ACTIVE" } });
    if (!current) throw notFound("No active subscription");
    const updated = await prisma.subscription.update({
      where: { id: current.id },
      data: { autoRenew: false, renewsAt: null },
      include: { plan: true },
    });
    res.json(updated);
  })
);

import { Router } from "express";
import { Prisma, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../config/prisma";
import { notFound } from "../../utils/httpError";
import { adminUserSelect, pageArgs, pageQuerySchema } from "./admin.shared";

export const adminSubscriptionsRouter = Router();

const listQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  planId: z.coerce.number().int().optional(),
});

// Admin screen: Subscriptions -> Subscribers tab.
adminSubscriptionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const where: Prisma.SubscriptionWhereInput = {
      status: q.status,
      planId: q.planId,
      user: q.search
        ? { OR: [{ fullName: { contains: q.search } }, { username: { contains: q.search } }, { email: { contains: q.search } }] }
        : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.subscription.findMany({
        where,
        include: { user: { select: adminUserSelect }, plan: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        ...pageArgs(q),
      }),
      prisma.subscription.count({ where }),
    ]);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  })
);

// Admin screen: Subscription Details (subscriber) with Billing History.
adminSubscriptionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const subscription = await prisma.subscription.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        user: { select: adminUserSelect },
        plan: true,
        payments: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!subscription) throw notFound("Subscription not found");
    res.json(subscription);
  })
);

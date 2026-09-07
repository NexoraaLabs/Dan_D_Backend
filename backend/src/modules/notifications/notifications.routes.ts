import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";

export const notificationsRouter = Router();

// Screen: Notifications
notificationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(notifications);
  })
);

notificationsRouter.post(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.notification.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Notification not found");
    if (existing.userId !== req.userId) throw forbidden();
    const updated = await prisma.notification.update({ where: { id: existing.id }, data: { readAt: new Date() } });
    res.json(updated);
  })
);

notificationsRouter.post(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.userId!, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).send();
  })
);

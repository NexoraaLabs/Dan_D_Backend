import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";

export const collectionsRouter = Router();

// Screens: Collections - Events / Collections - Event Detail
collectionsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const collections = await prisma.collection.findMany({
      where: { ownerId: req.userId! },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(collections);
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  coverImageUrl: z.string().url().optional(),
  location: z.string().max(120).optional(),
  eventDate: z.coerce.date().optional(),
});

collectionsRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const collection = await prisma.collection.create({ data: { ...input, ownerId: req.userId! } });
    res.status(201).json(collection);
  })
);

collectionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const collection = await prisma.collection.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: { include: { images: true } } },
    });
    if (!collection) throw notFound("Collection not found");
    res.json(collection);
  })
);

collectionsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.partial().parse(req.body);
    const existing = await prisma.collection.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Collection not found");
    if (existing.ownerId !== req.userId) throw forbidden();
    const collection = await prisma.collection.update({ where: { id: existing.id }, data: input });
    res.json(collection);
  })
);

collectionsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.collection.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw notFound("Collection not found");
    if (existing.ownerId !== req.userId) throw forbidden();
    await prisma.collection.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

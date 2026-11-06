import { Request, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { ensureDefaultCollections, sortCollections, withCover } from "./default-collections";

export const collectionsRouter = Router();

const baseUrl = (req: Request) => env.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;

async function findOwnCollection(req: Request) {
  const id = Number(req.params.id);
  const existing = Number.isInteger(id) ? await prisma.collection.findUnique({ where: { id } }) : null;
  if (!existing) throw notFound("Collection not found");
  if (existing.ownerId !== req.userId) throw forbidden();
  return existing;
}

// Screens: Collections - Events / Collections - Event Detail
collectionsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    await ensureDefaultCollections(req.userId!);
    const collections = await prisma.collection.findMany({
      where: { ownerId: req.userId! },
      include: { _count: { select: { items: true } } },
    });
    const base = baseUrl(req);
    res.json(sortCollections(collections).map((c) => withCover(c, base)));
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
    const id = Number(req.params.id);
    const collection = Number.isInteger(id)
      ? await prisma.collection.findUnique({ where: { id }, include: { items: { include: { images: true } } } })
      : null;
    if (!collection) throw notFound("Collection not found");
    res.json(withCover(collection, baseUrl(req)));
  })
);

collectionsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.partial().parse(req.body);
    const existing = await findOwnCollection(req);
    if (existing.kind && input.name !== undefined && input.name !== existing.name) throw badRequest("Default collections can’t be renamed");
    const collection = await prisma.collection.update({ where: { id: existing.id }, data: input });
    res.json(collection);
  })
);

collectionsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await findOwnCollection(req);
    if (existing.kind) throw badRequest("Default collections can’t be deleted");
    await prisma.collection.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

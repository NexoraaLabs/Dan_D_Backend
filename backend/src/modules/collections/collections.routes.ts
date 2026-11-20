import { Request, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { optionalUserId, requireAuth } from "../../middleware/auth";
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
    const sorted = sortCollections(collections).map((c) => withCover(c, base));
    // Top-level folders only; sub-folders ride along under children, and a parent's count includes theirs.
    res.json(
      sorted
        .filter((c) => c.parentId === null)
        .map((c) => {
          const children = sorted.filter((child) => child.parentId === c.id);
          if (children.length === 0) return { ...c, children };
          const items = c._count.items + children.reduce((sum, child) => sum + child._count.items, 0);
          return { ...c, children, _count: { items } };
        })
    );
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  coverImageUrl: z.string().url().optional(),
  location: z.string().max(120).optional(),
  eventDate: z.coerce.date().optional(),
  isPrivate: z.boolean().optional(),
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
      ? await prisma.collection.findUnique({
          where: { id },
          include: {
            items: { include: { images: true } },
            parent: { select: { id: true, name: true } },
            children: { include: { _count: { select: { items: true } } } },
          },
        })
      : null;
    // A private collection is the owner's business; to anyone else it doesn't exist.
    if (!collection || (collection.isPrivate && collection.ownerId !== optionalUserId(req))) throw notFound("Collection not found");
    const base = baseUrl(req);
    const children = sortCollections(collection.children).map((child) => withCover(child, base));
    res.json(withCover({ ...collection, children }, base));
  })
);

collectionsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = createSchema.partial().parse(req.body);
    const existing = await findOwnCollection(req);
    if (existing.kind && input.name !== undefined && input.name !== existing.name) throw badRequest("Default collections can’t be renamed");
    if (existing.kind && input.isPrivate) throw badRequest("Default collections can’t be made private");
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

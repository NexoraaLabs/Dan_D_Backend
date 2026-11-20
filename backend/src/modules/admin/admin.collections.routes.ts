import { Request, Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { notFound } from "../../utils/httpError";
import { sortCollections, withCover } from "../collections/default-collections";
import { pageArgs, pageQuerySchema } from "./admin.shared";

export const adminCollectionsRouter = Router();

const baseUrl = (req: Request) => env.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;

const ownerSelect = { id: true, username: true, fullName: true, email: true, avatarUrl: true } satisfies Prisma.UserSelect;

// Admin screen: Collections. Every user's collections, for moderation. Default folders nobody has
// put anything in are left out, otherwise each user would add nine empty rows.
adminCollectionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = pageQuerySchema
      .extend({
        search: z.string().trim().optional(),
        ownerId: z.coerce.number().int().optional(),
        type: z.enum(["default", "custom"]).optional(),
      })
      .parse(req.query);
    const where: Prisma.CollectionWhereInput = {
      ownerId: q.ownerId,
      AND: [
        { OR: [{ kind: null }, { items: { some: {} } }] },
        q.type === "default" ? { kind: { not: null } } : q.type === "custom" ? { kind: null } : {},
        q.search
          ? {
              OR: [
                { name: { contains: q.search } },
                { owner: { username: { contains: q.search } } },
                { owner: { fullName: { contains: q.search } } },
                { owner: { email: { contains: q.search } } },
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      prisma.collection.findMany({
        where,
        include: {
          owner: { select: ownerSelect },
          parent: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { updatedAt: "desc" },
        ...pageArgs(q),
      }),
      prisma.collection.count({ where }),
    ]);
    const base = baseUrl(req);
    res.json({ items: items.map((c) => withCover(c, base)), total, page: q.page, pageSize: q.pageSize });
  })
);

adminCollectionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const collection = Number.isInteger(id)
      ? await prisma.collection.findUnique({
          where: { id },
          include: {
            owner: { select: ownerSelect },
            parent: { select: { id: true, name: true } },
            children: { include: { _count: { select: { items: true } } } },
            items: {
              include: {
                images: { orderBy: { position: "asc" } },
                dealer: { select: { id: true, name: true, closedAt: true } },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        })
      : null;
    if (!collection) throw notFound("Collection not found");
    const base = baseUrl(req);
    const children = sortCollections(collection.children).map((child) => withCover(child, base));
    res.json(withCover({ ...collection, children }, base));
  })
);

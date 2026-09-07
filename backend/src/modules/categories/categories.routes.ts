import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";

export const categoriesRouter = Router();

// Screen: What Do You Collect (also reused by Settings -> What Do You Collect - Edit)
categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      include: { children: true },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  })
);

const interestsSchema = z.object({ categoryIds: z.array(z.number().int()) });

categoriesRouter.put(
  "/me/interests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { categoryIds } = interestsSchema.parse(req.body);
    await prisma.$transaction([
      prisma.userInterest.deleteMany({ where: { userId: req.userId! } }),
      prisma.userInterest.createMany({
        data: categoryIds.map((categoryId) => ({ userId: req.userId!, categoryId })),
      }),
    ]);
    res.status(204).send();
  })
);

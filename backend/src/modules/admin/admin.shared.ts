import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageArgs = (q: { page: number; pageSize: number }) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

/** Fields an admin sees for a user anywhere in the dashboard (never the password hash). */
export const adminUserSelect = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  avatarUrl: true,
  status: true,
  isAdmin: true,
  createdAt: true,
  lastActiveAt: true,
} satisfies Prisma.UserSelect;

type Db = typeof prisma | Prisma.TransactionClient;

export function recordAudit(
  db: Db,
  entry: { actorId: number; action: string; targetType: string; targetId?: number; reason?: string; data?: object }
) {
  return db.auditLog.create({ data: entry });
}

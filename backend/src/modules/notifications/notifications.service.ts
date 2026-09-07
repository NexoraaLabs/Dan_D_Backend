import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

type Db = typeof prisma | Prisma.TransactionClient;

export async function createNotification(
  db: Db,
  input: { userId: number; type: string; title: string; body?: string; data?: object }
) {
  return db.notification.create({ data: input });
}

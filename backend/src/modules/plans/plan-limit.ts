import { prisma } from "../../config/prisma";
import { forbidden } from "../../utils/httpError";

// Enforces the per-plan upload cap from the Subscription Model (Silver 200 /
// Gold 450 / Platinum unlimited / Free trial 100) before an item is created.
export async function assertCanAddItem(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { plan: true },
  });

  if (!user.plan || user.plan.itemLimit === null) return; // unlimited or no plan row yet

  const itemCount = await prisma.item.count({ where: { ownerId: userId } });
  if (itemCount >= user.plan.itemLimit) {
    throw forbidden(
      `Upload limit reached for the ${user.plan.name} plan (${user.plan.itemLimit} items). Upgrade to raise your limit.`
    );
  }
}

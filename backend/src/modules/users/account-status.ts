import type { AccountStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/httpError";

const HOUR = 60 * 60 * 1000;

function timeLeft(until: Date) {
  const hours = Math.ceil((until.getTime() - Date.now()) / HOUR);
  if (hours >= 48) return `${Math.ceil(hours / 24)} more days`;
  if (hours > 1) return `${hours} more hours`;
  return "less than an hour";
}

/**
 * Refuses a banned or suspended account. A timed suspension that has run out is lifted here, on the
 * user's next request or sign-in, so nothing has to run on a schedule. The message carries the note
 * the admin wrote, since the user can't open the app to read it anywhere else.
 */
export async function assertAccountUsable(user: { id: number; status: AccountStatus; suspendedUntil: Date | null }) {
  if (user.status === "BANNED") throw new HttpError(403, "This account has been closed", { code: "ACCOUNT_BANNED" });
  if (user.status !== "SUSPENDED") return;

  if (user.suspendedUntil && user.suspendedUntil <= new Date()) {
    await prisma.user.updateMany({ where: { id: user.id, status: "SUSPENDED" }, data: { status: "ACTIVE", suspendedUntil: null } });
    return;
  }

  const last = await prisma.moderationRecord.findFirst({
    where: { userId: user.id, action: "SUSPENSION" },
    orderBy: { createdAt: "desc" },
    select: { reason: true },
  });
  const length = user.suspendedUntil ? ` for ${timeLeft(user.suspendedUntil)}` : "";
  const reason = last ? ` Reason: ${last.reason}` : "";
  throw new HttpError(403, `This account is suspended${length}.${reason}`, { code: "ACCOUNT_SUSPENDED", until: user.suspendedUntil });
}

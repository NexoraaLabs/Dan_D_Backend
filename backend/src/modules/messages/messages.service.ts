import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";
import { emitToConversation, emitToUser } from "../../realtime/io";

// Shared by the REST endpoint (POST /messages/conversations/:id/messages)
// and the `message:send` socket event, so both paths validate and persist
// identically -- the socket handler is a thin transport on top of this.
export async function sendMessage(input: { conversationId: number; senderId: number; body?: string; attachmentUrl?: string }) {
  if (!input.body && !input.attachmentUrl) throw forbidden("Message must have a body or attachment");

  const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: input.conversationId } });
  if (!participants.some((p) => p.userId === input.senderId)) throw forbidden();

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.senderId,
      body: input.body,
      attachmentUrl: input.attachmentUrl,
    },
  });

  const others = participants.filter((p) => p.userId !== input.senderId);
  await Promise.all(
    others.map((p) =>
      createNotification(prisma, {
        userId: p.userId,
        type: "new_message",
        title: "New message",
        body: input.body?.slice(0, 120),
        data: { conversationId: input.conversationId },
      })
    )
  );

  emitToConversation(input.conversationId, "message:new", message);
  others.forEach((p) => emitToUser(p.userId, "notification:new", { type: "new_message", conversationId: input.conversationId }));

  return message;
}

export async function startConversation(input: { initiatorId: number; recipientId: number; body: string }) {
  if (input.initiatorId === input.recipientId) throw forbidden("Can't message yourself");

  const existing = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: input.initiatorId } } },
        { participants: { some: { userId: input.recipientId } } },
      ],
    },
  });

  const conversation =
    existing ??
    (await prisma.conversation.create({
      data: { participants: { create: [{ userId: input.initiatorId }, { userId: input.recipientId }] } },
    }));

  const message = await sendMessage({ conversationId: conversation.id, senderId: input.initiatorId, body: input.body });

  if (!existing) {
    // Only announce a brand-new thread; if it already existed, `message:new`
    // above is enough for a client that already has the conversation open.
    emitToUser(input.recipientId, "conversation:new", { conversationId: conversation.id });
  }

  return { conversationId: conversation.id, message };
}

export async function assertParticipant(conversationId: number, userId: number) {
  const participant = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!participant) throw forbidden();
}

export async function markRead(conversationId: number, userId: number) {
  const updated = await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: new Date() },
  });
  if (updated.count === 0) throw notFound("Conversation not found");
}

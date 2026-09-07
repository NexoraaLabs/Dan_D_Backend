import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import { forbidden, notFound } from "../../utils/httpError";
import { createNotification } from "../notifications/notifications.service";

export const messagesRouter = Router();

// Screens: Messages, Messages 2
messagesRouter.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: req.userId! } } },
      include: {
        participants: { include: { user: { select: { id: true, username: true, avatarUrl: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { id: "desc" },
    });
    res.json(conversations);
  })
);

const startSchema = z.object({ userId: z.number().int(), body: z.string().min(1) });

// Screens: Chat - Tom / Chat - ChipKing92 (first message starts the thread)
messagesRouter.post(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = startSchema.parse(req.body);
    if (input.userId === req.userId) throw forbidden("Can't message yourself");

    // Reuse an existing 1:1 conversation between these two users if present.
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId: req.userId! } } },
          { participants: { some: { userId: input.userId } } },
        ],
      },
    });

    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: { participants: { create: [{ userId: req.userId! }, { userId: input.userId }] } },
      }));

    const message = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: req.userId!, body: input.body },
    });

    await createNotification(prisma, {
      userId: input.userId,
      type: "new_message",
      title: "New message",
      body: input.body.slice(0, 120),
      data: { conversationId: conversation.id },
    });

    res.status(201).json({ conversationId: conversation.id, message });
  })
);

messagesRouter.get(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = Number(req.params.id);
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.userId! } },
    });
    if (!participant) throw forbidden();

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  })
);

const sendSchema = z.object({ body: z.string().optional(), attachmentUrl: z.string().url().optional() });

messagesRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = Number(req.params.id);
    const input = sendSchema.parse(req.body);
    if (!input.body && !input.attachmentUrl) throw forbidden("Message must have a body or attachment");

    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId } });
    if (!participants.some((p) => p.userId === req.userId)) throw forbidden();

    const message = await prisma.message.create({
      data: { conversationId, senderId: req.userId!, body: input.body, attachmentUrl: input.attachmentUrl },
    });

    const others = participants.filter((p) => p.userId !== req.userId);
    await Promise.all(
      others.map((p) =>
        createNotification(prisma, {
          userId: p.userId,
          type: "new_message",
          title: "New message",
          body: input.body?.slice(0, 120),
          data: { conversationId },
        })
      )
    );

    res.status(201).json(message);
  })
);

messagesRouter.post(
  "/conversations/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = Number(req.params.id);
    const updated = await prisma.conversationParticipant.updateMany({
      where: { conversationId, userId: req.userId! },
      data: { lastReadAt: new Date() },
    });
    if (updated.count === 0) throw notFound("Conversation not found");
    res.status(204).send();
  })
);

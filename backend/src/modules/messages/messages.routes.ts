import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../config/prisma";
import * as messagesService from "./messages.service";

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
    const result = await messagesService.startConversation({
      initiatorId: req.userId!,
      recipientId: input.userId,
      body: input.body,
    });
    res.status(201).json(result);
  })
);

messagesRouter.get(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = Number(req.params.id);
    await messagesService.assertParticipant(conversationId, req.userId!);

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  })
);

const sendSchema = z.object({ body: z.string().optional(), attachmentUrl: z.string().url().optional() });

// Also reachable live via the `message:send` socket event -- see src/realtime.
messagesRouter.post(
  "/conversations/:id/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const conversationId = Number(req.params.id);
    const input = sendSchema.parse(req.body);
    const message = await messagesService.sendMessage({ conversationId, senderId: req.userId!, ...input });
    res.status(201).json(message);
  })
);

messagesRouter.post(
  "/conversations/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    await messagesService.markRead(Number(req.params.id), req.userId!);
    res.status(204).send();
  })
);

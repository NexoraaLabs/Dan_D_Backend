import { Server, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { verifyAccessToken } from "../utils/jwt";
import * as messagesService from "../modules/messages/messages.service";
import { setIo, conversationRoom, userRoom } from "./io";
import { HttpError } from "../utils/httpError";

interface AuthedSocket extends Socket {
  data: { userId: number };
}

// Client connects with `io(url, { auth: { token: accessToken } })` using the
// same JWT access token as the REST API -- one login, both transports.
function authenticate(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error("Missing auth token"));
  try {
    const payload = verifyAccessToken(token);
    (socket as AuthedSocket).data.userId = payload.sub;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
}

export function initChatSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    // Dev-permissive CORS; lock this down to the app's real origin(s) once deployed.
    cors: { origin: "*" },
  });
  setIo(io);

  io.use(authenticate);

  io.on("connection", (socket: AuthedSocket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));

    // Screens: Chat - Tom / Chat - ChipKing92 -- client joins right before
    // opening a thread so it starts receiving message:new for it.
    socket.on("conversation:join", async (payload: { conversationId: number }, ack?: (res: unknown) => void) => {
      try {
        await messagesService.assertParticipant(payload.conversationId, userId);
        socket.join(conversationRoom(payload.conversationId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: errorMessage(err) });
      }
    });

    socket.on("conversation:leave", (payload: { conversationId: number }) => {
      socket.leave(conversationRoom(payload.conversationId));
    });

    socket.on(
      "message:send",
      async (payload: { conversationId: number; body?: string; attachmentUrl?: string }, ack?: (res: unknown) => void) => {
        try {
          const message = await messagesService.sendMessage({
            conversationId: payload.conversationId,
            senderId: userId,
            body: payload.body,
            attachmentUrl: payload.attachmentUrl,
          });
          // sendMessage already broadcasts "message:new" to the room; ack
          // just confirms success to the sender with the persisted message.
          ack?.({ ok: true, message });
        } catch (err) {
          ack?.({ ok: false, error: errorMessage(err) });
        }
      }
    );

    socket.on("typing:start", (payload: { conversationId: number }) => {
      socket.to(conversationRoom(payload.conversationId)).emit("typing", { conversationId: payload.conversationId, userId, isTyping: true });
    });

    socket.on("typing:stop", (payload: { conversationId: number }) => {
      socket.to(conversationRoom(payload.conversationId)).emit("typing", { conversationId: payload.conversationId, userId, isTyping: false });
    });

    socket.on("conversation:read", async (payload: { conversationId: number }, ack?: (res: unknown) => void) => {
      try {
        await messagesService.markRead(payload.conversationId, userId);
        socket.to(conversationRoom(payload.conversationId)).emit("conversation:read", { conversationId: payload.conversationId, userId });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: errorMessage(err) });
      }
    });
  });

  return io;
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

import { Server } from "socket.io";

let io: Server | undefined;

export function setIo(instance: Server) {
  io = instance;
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.IO server not initialized yet");
  return io;
}

export function conversationRoom(conversationId: number): string {
  return `conversation:${conversationId}`;
}

export function userRoom(userId: number): string {
  return `user:${userId}`;
}

// Safe to call before the socket server exists (e.g. in tests, or if a REST
// request handler runs before initSocket has run) -- realtime push is a
// nice-to-have on top of the REST API, never a requirement for correctness.
export function emitToConversation(conversationId: number, event: string, payload: unknown) {
  if (!io) return;
  io.to(conversationRoom(conversationId)).emit(event, payload);
}

export function emitToUser(userId: number, event: string, payload: unknown) {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
}

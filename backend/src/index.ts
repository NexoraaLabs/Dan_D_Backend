import { createServer } from "http";
import { createApp } from "./app";
import { initChatSocket } from "./realtime/chat.socket";
import { env } from "./config/env";
import { startScheduler } from "./jobs/scheduler";

const app = createApp();
const httpServer = createServer(app);
initChatSocket(httpServer);
startScheduler();

httpServer.listen(env.port, () => {
  console.log(`DAN D Collection API listening on http://localhost:${env.port}`);
  console.log(`Chat WebSocket ready on the same port`);
});

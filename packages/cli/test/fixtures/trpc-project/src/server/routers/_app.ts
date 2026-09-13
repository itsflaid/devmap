import { router } from "../trpc";
import { roomRouter } from "./room";
import { messageRouter } from "./message";

export const appRouter = router({
  room: roomRouter,
  message: messageRouter,
});

export type AppRouter = typeof appRouter;

import { z } from "zod";
import { router, publicProcedure } from "../trpc";

export const roomRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.room.findMany();
  }),
  create: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.room.create({ data: input });
    }),
});

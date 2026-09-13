import { z } from "zod";
import { router, publicProcedure } from "../trpc";

export const messageRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.message.findMany();
  }),
  create: publicProcedure
    .input(z.object({ content: z.string(), roomId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.message.create({ data: input });
    }),
});

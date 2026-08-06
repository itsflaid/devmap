import { prisma } from "@/lib/db";

export async function getTodos() {
  return prisma.todo.findMany({ orderBy: { createdAt: "desc" } });
}

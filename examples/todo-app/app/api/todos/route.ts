import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const todos = await prisma.todo.findMany();
  return NextResponse.json(todos);
}

export async function POST(request: Request) {
  const body = await request.json();
  const todo = await prisma.todo.create({ data: body });
  return NextResponse.json(todo);
}

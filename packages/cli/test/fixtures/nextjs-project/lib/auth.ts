import NextAuth from "next-auth";
import { database } from "./db.js";

export const auth = NextAuth({ providers: [] });

export async function getSession() {
  await database.user.count();
  return auth.auth();
}

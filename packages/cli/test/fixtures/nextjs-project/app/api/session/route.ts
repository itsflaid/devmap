import { getSession } from "../../../lib/auth.js";

export async function GET() {
  return Response.json(await getSession());
}

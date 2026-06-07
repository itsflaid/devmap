import { getSession } from "../lib/auth.js";

export default async function HomePage() {
  const session = await getSession();
  return <main>{session?.user?.name ?? "Guest"}</main>;
}

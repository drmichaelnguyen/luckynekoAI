import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminPanel } from "./admin-panel";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/");
  }
  return <AdminPanel />;
}

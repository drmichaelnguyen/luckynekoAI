import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hasAdminAccess } from "@/lib/admin-access";

import { AdminPortal } from "./admin-portal";

export default async function AdminPortalPage() {
  const session = await auth();
  if (!hasAdminAccess(session)) {
    redirect("/");
  }

  return <AdminPortal />;
}

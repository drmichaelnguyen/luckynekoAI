import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { AnalyticsPageClient } from "./analytics-client";

export const metadata = {
  title: "Analytics",
};

function AnalyticsFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 text-sm text-muted-foreground">
      Loading analytics…
    </div>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <Suspense fallback={<AnalyticsFallback />}>
      <AnalyticsPageClient />
    </Suspense>
  );
}

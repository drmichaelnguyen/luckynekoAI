import { Suspense } from "react";

import { ClientLoading } from "@/components/i18n/client-loading";

import { GuidePageClient } from "./guide-page-client";

export default function GuidePage() {
  return (
    <Suspense fallback={<ClientLoading />}>
      <GuidePageClient />
    </Suspense>
  );
}

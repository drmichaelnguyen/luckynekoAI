import { Suspense } from "react";

import { ClientLoading } from "@/components/i18n/client-loading";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<ClientLoading />}>
      <LoginForm />
    </Suspense>
  );
}

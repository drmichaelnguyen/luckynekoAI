import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { prisma } from "@/lib/prisma";

function ChatFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 text-sm text-muted-foreground">
      Loading chat…
    </div>
  );
}

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { onboardingCompleted: true },
  });
  if (!user?.onboardingCompleted) redirect("/onboarding");

  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatInterface />
    </Suspense>
  );
}

import { Suspense } from "react";

import { ChatInterface } from "@/components/chat/chat-interface";

function ChatFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 text-sm text-muted-foreground">
      Loading chat…
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatInterface />
    </Suspense>
  );
}

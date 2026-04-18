import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Guide",
  description: "How to use NekoZeni, install it as a phone app, and share photos from your camera or gallery.",
};

export default function GuideLayout({ children }: { children: ReactNode }) {
  return children;
}

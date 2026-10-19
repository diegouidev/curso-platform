import type { Metadata } from "next";

export const metadata: Metadata = { title: "Configuração inicial" };

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="grid max-w-sm justify-items-center gap-5 text-center">
        <Brand />
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <Compass className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <div className="grid gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
          <p className="text-sm text-muted-foreground">
            O endereço pode estar errado ou o conteúdo foi removido. Seus cursos continuam na página
            inicial.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Ir para os cursos</Link>
        </Button>
      </div>
    </main>
  );
}

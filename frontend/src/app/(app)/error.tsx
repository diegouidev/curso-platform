"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Unexpected rendering error inside the app shell: keep the header, offer a way out. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertTriangle className="size-6 text-destructive" aria-hidden />
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold">Algo deu errado nesta tela</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Seu progresso e suas anotações estão salvos. Tente de novo; se continuar, recarregue a
            página.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RotateCw /> Tentar de novo
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Ir para os cursos</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

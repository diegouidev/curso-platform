"use client";

import { Layers } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";

import { useReview } from "./api";

/** Dashboard nudge when spaced-repetition cards are due today. */
export function ReviewDueBanner() {
  const { data } = useReview();
  if (!data?.due) return null;

  return (
    <section
      aria-label="Revisão de hoje"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted max-sm:hidden">
        <Layers className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="grid flex-1 gap-0.5">
        <p className="font-medium">
          {plural(data.due, "cartão para revisar hoje", "cartões para revisar hoje")}
        </p>
        <p className="text-sm text-muted-foreground">
          Perguntas das suas anotações. Leva poucos minutos.
        </p>
      </div>
      <Button asChild variant="outline" className="max-sm:h-10">
        <Link href="/review">Revisar agora</Link>
      </Button>
    </section>
  );
}

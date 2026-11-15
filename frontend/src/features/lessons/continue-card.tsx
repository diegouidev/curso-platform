"use client";

import { BookOpen, Play } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format";

import { lessonPath, useContinue } from "./api";
import { CONTINUE_LABELS } from "./continue-button";

const HEADINGS = {
  resume: "Continuar assistindo",
  next: "Próxima aula",
  start: "Comece por aqui",
} as const;

/** Dashboard highlight: the lesson to pick up next. Renders nothing when everything is done. */
export function ContinueCard() {
  const { data, isPending, isError } = useContinue();

  if (isPending) return <Skeleton className="h-36 rounded-xl sm:h-32" />;
  if (isError || !data.lesson || !data.reason) return null;

  const { lesson, reason } = data;
  const href = lessonPath(lesson.course.id, lesson.id);
  const watched = lesson.progress.time_on_page_seconds;

  return (
    <section
      aria-labelledby="continuar-titulo"
      className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-xl border bg-card p-3 sm:flex sm:gap-4 sm:p-5"
    >
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden
        className="relative grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-muted to-muted/40 sm:w-44"
      >
        {lesson.course.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local uploads, no optimizer needed
          <img
            src={lesson.course.thumbnail_url}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <BookOpen className="size-8 text-muted-foreground/60" />
        )}
        <span className="absolute grid size-8 place-items-center rounded-full bg-background/90 shadow-sm sm:size-10">
          <Play className="size-4 translate-x-px" />
        </span>
      </Link>

      <div className="grid min-w-0 flex-1 gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {HEADINGS[reason]}
        </p>
        <h2
          id="continuar-titulo"
          className="line-clamp-2 text-base leading-snug font-semibold sm:text-lg"
        >
          {lesson.title}
        </h2>
        <p className="truncate text-sm text-muted-foreground">
          {lesson.course.title} · {lesson.module.title}
          {lesson.section && ` · ${lesson.section}`}
        </p>
        {reason === "resume" && watched >= 60 && (
          <p className="text-xs text-muted-foreground">
            {formatDuration(watched)} nesta aula até agora
          </p>
        )}
      </div>

      <Button size="lg" asChild className="col-span-2 max-sm:h-11 sm:self-center">
        <Link href={href}>
          <Play /> {CONTINUE_LABELS[reason]}
        </Link>
      </Button>
    </section>
  );
}

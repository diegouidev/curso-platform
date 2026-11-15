"use client";

import { CalendarDays, Clock, Layers, NotebookPen, PartyPopper, Trophy } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { lessonPath } from "@/features/lessons/api";
import { formatDuration, formatLongDate, plural } from "@/lib/format";

import { useCourseRecap, type CourseDetail } from "./api";

/** "Curso concluído": what studying it looked like. Shown when every lesson is done. */
export function CourseRecapCard({ course }: { course: CourseDetail }) {
  const { data, isPending, isError } = useCourseRecap(course.id);

  if (isPending) return <Skeleton className="h-48 rounded-xl" />;
  if (isError || !data.is_complete) return null;

  const period =
    data.started_on && data.finished_on
      ? data.started_on === data.finished_on
        ? `em ${formatLongDate(data.finished_on)}`
        : `de ${formatLongDate(data.started_on)} a ${formatLongDate(data.finished_on)}`
      : null;

  return (
    <section
      id="resumo"
      aria-labelledby="resumo-titulo"
      className="grid scroll-mt-20 grid-cols-1 gap-4 rounded-xl border border-emerald-600/30 bg-emerald-50/60 p-4 sm:p-5 dark:bg-emerald-400/5"
    >
      <div className="grid gap-1">
        <h2 id="resumo-titulo" className="flex items-center gap-2 text-lg font-semibold">
          <PartyPopper className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Curso concluído
        </h2>
        <p className="text-sm text-muted-foreground">
          {plural(data.lessons_completed, "aula concluída", "aulas concluídas")}
          {period && ` ${period}`}.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RecapStat
          icon={Clock}
          label="Tempo de estudo"
          value={data.study_seconds ? formatDuration(data.study_seconds) : "—"}
        />
        <RecapStat
          icon={CalendarDays}
          label="Dias de estudo"
          value={plural(data.days_studied, "dia", "dias")}
        />
        <RecapStat
          icon={NotebookPen}
          label="Anotações"
          value={String(data.notes_count)}
          href={data.notes_count ? `/courses/${course.id}/notebook` : undefined}
        />
        <RecapStat
          icon={Layers}
          label="Cartões de revisão"
          value={String(data.cards_count)}
          href={data.cards_count ? "/review" : undefined}
        />
      </dl>
      {(data.top_lesson || data.busiest_day) && (
        <ul className="grid gap-1.5 text-sm">
          {data.top_lesson && (
            <li className="flex items-start gap-2">
              <Trophy className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              <span>
                Aula em que você passou mais tempo:{" "}
                <Link
                  href={lessonPath(course.id, data.top_lesson.id)}
                  className="font-medium underline underline-offset-4"
                >
                  {data.top_lesson.title}
                </Link>{" "}
                ({formatDuration(data.top_lesson.seconds)})
              </span>
            </li>
          )}
          {data.busiest_day && (
            <li className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                Dia mais intenso: {formatLongDate(data.busiest_day.date)} (
                {formatDuration(data.busiest_day.study_seconds)})
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function RecapStat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-background/80 px-3 py-2 ring-1 ring-foreground/5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden /> {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">
        {href ? (
          <Link href={href} className="underline-offset-4 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

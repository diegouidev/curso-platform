"use client";

import { CalendarCheck, Clock, Flame } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useStats, type StudyStats } from "./api";

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

// API dates are plain "YYYY-MM-DD" (local study days); build them at local noon so the
// browser's time zone can't shift them to the previous day.
const toDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** KPI row: completions this week, study streak, study time (with the last 7 days). */
export function StatsRow() {
  const { data, isPending, isError } = useStats();

  if (isPending) {
    return (
      <div
        className="grid gap-4 sm:grid-cols-3"
        aria-busy="true"
        aria-label="Carregando estatísticas"
      >
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  // Stats are a bonus on the dashboard: on error the courses below still matter more.
  if (isError) return null;

  return (
    <section aria-labelledby="estatisticas" className="grid gap-3">
      <h2 id="estatisticas" className="sr-only">
        Estatísticas de estudo
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={CalendarCheck}
          label="Aulas concluídas esta semana"
          value={String(data.completed_this_week)}
          detail={`${plural(data.completed_total, "aula concluída", "aulas concluídas")} no total`}
        />
        <StatTile
          icon={Flame}
          label="Sequência de estudo"
          value={plural(data.streak_days, "dia", "dias")}
          detail={streakDetail(data)}
        />
        <StatTile
          icon={Clock}
          label="Tempo de estudo"
          value={data.study_seconds_total ? formatDuration(data.study_seconds_total) : "0 min"}
          detail={`${data.study_seconds_this_week ? formatDuration(data.study_seconds_this_week) : "Nada"} esta semana`}
        >
          <RecentDays days={data.recent_days} />
        </StatTile>
      </div>
    </section>
  );
}

function streakDetail(data: StudyStats): string {
  if (data.streak_days > 0 && !data.studied_today) return "Estude hoje para manter a sequência";
  if (data.longest_streak_days > data.streak_days) {
    return `Recorde: ${plural(data.longest_streak_days, "dia", "dias")}`;
  }
  return data.streak_days > 0 ? "Seu melhor ritmo até agora" : "Assista a uma aula para começar";
}

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="grid min-w-0 gap-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}

/** 7 thin bars of study time, today in the accent and past days in the recessive ink. */
function RecentDays({ days }: { days: StudyStats["recent_days"] }) {
  const max = Math.max(...days.map((day) => day.study_seconds), 1);

  return (
    <figure className="shrink-0">
      <div className="flex h-12 items-end gap-0.5" aria-hidden>
        {days.map((day, index) => {
          const today = index === days.length - 1;
          const height = day.study_seconds ? Math.max((day.study_seconds / max) * 100, 8) : 0;
          return (
            <div key={day.date} className="group relative flex h-full w-2.5 items-end">
              <div
                className={cn(
                  "w-full rounded-t-[4px]",
                  day.study_seconds === 0 && "h-0.5 rounded-none bg-border",
                  day.study_seconds > 0 && (today ? "bg-foreground" : "bg-muted-foreground/45"),
                )}
                style={day.study_seconds ? { height: `${height}%` } : undefined}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm group-hover:block">
                <span className="capitalize">{weekday.format(toDate(day.date))}</span>:{" "}
                {day.study_seconds ? formatDuration(day.study_seconds) : "sem estudo"}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="sr-only">
        Tempo de estudo nos últimos 7 dias:
        <ul>
          {days.map((day) => (
            <li key={day.date}>
              {longDate.format(toDate(day.date))}:{" "}
              {day.study_seconds ? formatDuration(day.study_seconds) : "sem estudo"}
              {day.completed
                ? `, ${plural(day.completed, "aula concluída", "aulas concluídas")}`
                : ""}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

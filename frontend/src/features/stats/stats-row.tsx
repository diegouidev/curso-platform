"use client";

import { CalendarCheck, CheckCircle2, Clock, Flame, Sun } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, parseDay, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useStats, type StudyStats } from "./api";

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const longDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** KPI row: today (against the daily goal), streak, this week (against the weekly goal),
 * total study time with the last 7 days. */
export function StatsRow() {
  const { data, isPending, isError } = useStats();

  if (isPending) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        aria-busy="true"
        aria-label="Carregando estatísticas"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }
  // Stats are a bonus on the dashboard: on error the courses below still matter more.
  if (isError) return null;

  const todayMinutes = Math.floor(data.study_seconds_today / 60);
  const weekMinutes = Math.floor(data.study_seconds_this_week / 60);

  return (
    <section aria-labelledby="estatisticas" className="grid gap-3">
      <h2 id="estatisticas" className="sr-only">
        Estatísticas de estudo
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          icon={Sun}
          label="Hoje"
          value={data.study_seconds_today ? formatDuration(data.study_seconds_today) : "0 min"}
          detail={
            data.daily_goal_minutes ? null : (
              <Link
                href="/settings#metas"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Definir meta diária
              </Link>
            )
          }
        >
          {data.daily_goal_minutes > 0 && (
            <GoalMeter label="Meta do dia" done={todayMinutes} goal={data.daily_goal_minutes} />
          )}
        </StatTile>
        <StatTile
          icon={Flame}
          label="Sequência"
          value={plural(data.streak_days, "dia", "dias")}
          detail={streakDetail(data)}
        />
        <StatTile
          icon={CalendarCheck}
          label="Esta semana"
          value={plural(data.completed_this_week, "aula", "aulas")}
          detail={
            data.weekly_goal_minutes
              ? null
              : `${data.study_seconds_this_week ? formatDuration(data.study_seconds_this_week) : "Nada"} de estudo`
          }
        >
          {data.weekly_goal_minutes > 0 && (
            <GoalMeter label="Meta da semana" done={weekMinutes} goal={data.weekly_goal_minutes} />
          )}
        </StatTile>
        <StatTile
          icon={Clock}
          label="Tempo de estudo"
          value={data.study_seconds_total ? formatDuration(data.study_seconds_total) : "0 min"}
          detail={`${plural(data.completed_total, "aula concluída", "aulas concluídas")}`}
        >
          <RecentDays days={data.recent_days} />
        </StatTile>
      </div>
    </section>
  );
}

function streakDetail(data: StudyStats): string {
  if (data.streak_days > 0 && !data.studied_today) return "Estude hoje para manter";
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
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="grid min-w-0 gap-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
        </p>
        <p className="text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      {children}
    </div>
  );
}

/** A single ratio against a limit: the fill and its track share one ramp. */
function GoalMeter({ label, done, goal }: { label: string; done: number; goal: number }) {
  const reached = done >= goal;
  const percent = Math.min((done / goal) * 100, 100);
  return (
    <div className="grid gap-1.5">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(done, goal)}
        aria-valuetext={`${done} de ${goal} minutos`}
        className="h-2 overflow-hidden rounded-full bg-[var(--meter-track)]"
      >
        <div
          className="h-full rounded-full bg-[var(--meter-fill)] transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {reached ? (
          <>
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Meta cumprida · {done} min
          </>
        ) : (
          <span className="tabular-nums">
            {done} de {goal} min
          </span>
        )}
      </p>
    </div>
  );
}

/** 7 thin bars of study time, today in the accent and past days in the recessive ink. */
function RecentDays({ days }: { days: StudyStats["recent_days"] }) {
  const max = Math.max(...days.map((day) => day.study_seconds), 1);

  return (
    <figure className="shrink-0">
      <div className="flex h-10 items-end gap-0.5 sm:h-12" aria-hidden>
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
                <span className="capitalize">{weekday.format(parseDay(day.date))}</span>:{" "}
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
              {longDate.format(parseDay(day.date))}:{" "}
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

"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, parseDay, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCalendar, type StudyCalendar } from "./api";

type Day = StudyCalendar["days"][number];

const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const WEEKDAY_LABELS = ["seg", "", "qua", "", "sex", "", ""];
// Thresholds in minutes for the four filled steps of the ramp.
const LEVELS = [1, 15, 45, 90];
const LEVEL_LABELS = ["Sem estudo", "Até 15 min", "15 a 45 min", "45 a 90 min", "Mais de 90 min"];

function level(day: Day | undefined): number {
  if (!day) return 0;
  const minutes = day.study_seconds / 60;
  if (minutes < 1) return day.completed ? 1 : 0;
  return LEVELS.filter((threshold) => minutes >= threshold).length;
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** A year of study days: one column per week (Monday first), shaded by time studied. */
export function StudyCalendarSection() {
  const { data, isPending, isError } = useCalendar();

  if (isPending) return <Skeleton className="h-44 rounded-xl" />;
  if (isError) return null;
  return <CalendarView calendar={data} />;
}

function CalendarView({ calendar }: { calendar: StudyCalendar }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ date: string; x: number; y: number } | null>(null);
  const byDate = useMemo(
    () => new Map(calendar.days.map((day) => [day.date, day])),
    [calendar.days],
  );

  const weeks = useMemo(() => {
    const result: string[][] = [];
    const cursor = parseDay(calendar.start);
    const end = parseDay(calendar.end);
    while (cursor <= end) {
      const week: string[] = [];
      for (let index = 0; index < 7 && cursor <= end; index += 1) {
        week.push(iso(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  }, [calendar.start, calendar.end]);

  // On narrow screens the grid scrolls sideways: start at the most recent weeks.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks]);

  const active = calendar.days.filter((day) => level(day) > 0);
  const hoveredDay = hovered ? byDate.get(hovered.date) : undefined;

  return (
    <section
      aria-labelledby="calendario-titulo"
      className="grid grid-cols-1 gap-3 rounded-xl border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="calendario-titulo" className="flex items-center gap-2 font-medium">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          Seu ano de estudo
        </h2>
        <p className="text-sm text-muted-foreground">
          {plural(calendar.days_studied, "dia de estudo", "dias de estudo")}
          {calendar.study_seconds > 0 && ` · ${formatDuration(calendar.study_seconds)}`}
        </p>
      </div>

      <div className="relative">
        <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain pb-1">
          <div className="inline-grid grid-cols-[auto_1fr] gap-x-2" aria-hidden>
            <div />
            <div className="flex gap-[3px] text-[0.6875rem] text-muted-foreground">
              {weeks.map((week, index) => {
                const first = parseDay(week[0] ?? calendar.start);
                const showMonth = index === 0 ? first.getDate() <= 21 : first.getDate() <= 7;
                return (
                  <span key={week[0]} className="w-[11px] overflow-visible whitespace-nowrap">
                    {showMonth ? monthFormat.format(first).replace(".", "") : ""}
                  </span>
                );
              })}
            </div>
            <div className="grid grid-rows-7 gap-[3px] pt-px text-[0.6875rem] leading-[11px] text-muted-foreground">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={index}>{label}</span>
              ))}
            </div>
            <div className="flex gap-[3px]" onPointerLeave={() => setHovered(null)}>
              {weeks.map((week) => (
                <div key={week[0]} className="grid grid-rows-7 gap-[3px]">
                  {week.map((date) => (
                    <div
                      key={date}
                      onPointerEnter={(event) => {
                        const cell = event.currentTarget.getBoundingClientRect();
                        const box = scrollRef.current?.parentElement?.getBoundingClientRect();
                        if (!box) return;
                        // Keep the tooltip (about 160px wide, centered) inside the section.
                        const x = Math.min(
                          Math.max(cell.left - box.left + 5, 80),
                          Math.max(box.width - 80, 80),
                        );
                        setHovered({ date, x, y: cell.top - box.top });
                      }}
                      className={cn(
                        "size-[11px] rounded-[2px] transition-[outline] hover:outline hover:outline-2 hover:outline-foreground/60",
                        date === calendar.end && "outline outline-1 outline-foreground/50",
                      )}
                      style={{ backgroundColor: `var(--heat-${level(byDate.get(date))})` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
            style={{ left: hovered.x, top: hovered.y }}
          >
            <span className="font-semibold">
              {hoveredDay?.study_seconds ? formatDuration(hoveredDay.study_seconds) : "Sem estudo"}
            </span>
            {hoveredDay?.completed
              ? ` · ${plural(hoveredDay.completed, "aula concluída", "aulas concluídas")}`
              : ""}
            <span className="block text-muted-foreground">
              {dayFormat.format(parseDay(hovered.date))}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5" aria-hidden>
          Menos
          {LEVEL_LABELS.map((label, index) => (
            <span
              key={label}
              title={label}
              className="size-[11px] rounded-[2px]"
              style={{ backgroundColor: `var(--heat-${index})` }}
            />
          ))}
          Mais
        </div>
        {active.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer hover:text-foreground">Ver como lista</summary>
            <ul className="mt-2 grid max-h-48 gap-0.5 overflow-y-auto">
              {[...active].reverse().map((day) => (
                <li key={day.date}>
                  {dayFormat.format(parseDay(day.date))}:{" "}
                  {day.study_seconds ? formatDuration(day.study_seconds) : "sem tempo registrado"}
                  {day.completed
                    ? `, ${plural(day.completed, "aula concluída", "aulas concluídas")}`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="sr-only">
        Calendário dos últimos 12 meses: {plural(calendar.days_studied, "dia", "dias")} com estudo.{" "}
        {active.length > 0 && "A lista com cada dia está em “Ver como lista”."}
      </p>
    </section>
  );
}

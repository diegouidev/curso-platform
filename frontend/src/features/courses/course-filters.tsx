"use client";

import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

import type { Course } from "./api";

const STORAGE_KEY = "dashboard:course-filters";

const STATUSES = [
  { value: "all", label: "Todos" },
  { value: "in_progress", label: "Em andamento" },
  { value: "not_started", label: "Não iniciados" },
  { value: "done", label: "Concluídos" },
] as const;

type Status = (typeof STATUSES)[number]["value"];
export type CourseFilter = { status: Status; tag: string | null };

const DEFAULT_FILTER: CourseFilter = { status: "all", tag: null };

function courseStatus(course: Course): Exclude<Status, "all"> {
  const { lessons_total: total, lessons_completed: done } = course.progress;
  if (total > 0 && done === total) return "done";
  return done > 0 ? "in_progress" : "not_started";
}

export function applyCourseFilter(courses: Course[], filter: CourseFilter): Course[] {
  return courses.filter(
    (course) =>
      (filter.status === "all" || courseStatus(course) === filter.status) &&
      (filter.tag == null || course.tags.includes(filter.tag)),
  );
}

/** The dashboard filter, remembered in this browser. */
export function useCourseFilter(): [CourseFilter, (filter: CourseFilter) => void] {
  const [filter, setFilter] = useState<CourseFilter>(DEFAULT_FILTER);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setFilter({ ...DEFAULT_FILTER, ...(JSON.parse(saved) as Partial<CourseFilter>) });
    } catch {
      // Storage blocked or invalid: start unfiltered.
    }
  }, []);

  const update = (next: CourseFilter) => {
    setFilter(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  return [filter, update];
}

/** Status pills and tag chips above the course grid. */
export function CourseFilters({
  courses,
  filter,
  onChange,
}: {
  courses: Course[];
  filter: CourseFilter;
  onChange: (filter: CourseFilter) => void;
}) {
  const tags = [...new Set(courses.flatMap((course) => course.tags))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const labelId = useId();
  // A remembered tag that no longer exists shouldn't hide everything.
  useEffect(() => {
    if (filter.tag && !tags.includes(filter.tag)) onChange({ ...filter, tag: null });
  });

  return (
    <div className="grid grid-cols-1 gap-2">
      <span id={labelId} className="sr-only">
        Filtrar cursos
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {STATUSES.map(({ value, label }) => {
          const count =
            value === "all"
              ? courses.length
              : courses.filter((course) => courseStatus(course) === value).length;
          return (
            <Pill
              key={value}
              pressed={filter.status === value}
              onClick={() => onChange({ ...filter, status: value })}
            >
              {label} <span className="text-xs tabular-nums">{count}</span>
            </Pill>
          );
        })}
        {tags.length > 0 && (
          <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden />
        )}
        {tags.map((tag) => (
          <Pill
            key={tag}
            pressed={filter.tag === tag}
            onClick={() => onChange({ ...filter, tag: filter.tag === tag ? null : tag })}
          >
            # {tag}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Pill({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:h-8",
        pressed && "border-foreground bg-foreground text-background hover:text-background",
      )}
    >
      {children}
    </button>
  );
}

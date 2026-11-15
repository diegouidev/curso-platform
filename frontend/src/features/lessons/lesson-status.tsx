import { CheckCircle2, Circle, CloudOff, PlayCircle, Star } from "lucide-react";

import type { LessonSummary } from "@/features/courses/api";
import { cn } from "@/lib/utils";

/** A lesson opened for at least this long, and not completed, is "in progress". */
export const IN_PROGRESS_MIN_SECONDS = 60;

type Status = "completed" | "in_progress" | "current" | "missing" | "not_started";

type StatusLesson = Pick<
  LessonSummary,
  "completed" | "watched_seconds" | "duration_seconds" | "missing_in_drive"
>;

export function lessonStatus(lesson: StatusLesson, current = false): Status {
  if (lesson.completed) return "completed";
  if (current) return "current";
  if (lesson.missing_in_drive) return "missing";
  if (lesson.watched_seconds >= IN_PROGRESS_MIN_SECONDS) return "in_progress";
  return "not_started";
}

const LABELS: Record<Status, string> = {
  completed: "Concluída",
  in_progress: "Em andamento",
  current: "Aula atual",
  missing: "Fora do Drive",
  not_started: "Não iniciada",
};

/**
 * Completed (check), in progress (a ring filled by the time on the page against the video
 * length, capped below full: time on the page is not time watched), or not started.
 */
export function LessonStatusIcon({
  lesson,
  current = false,
  className,
}: {
  lesson: StatusLesson;
  current?: boolean;
  className?: string;
}) {
  const status = lessonStatus(lesson, current);
  const classes = cn("size-4 shrink-0", className);

  return (
    <>
      {status === "completed" ? (
        <CheckCircle2
          className={cn(classes, "text-emerald-600 dark:text-emerald-400")}
          aria-hidden
        />
      ) : status === "current" ? (
        <PlayCircle className={cn(classes, "text-foreground")} aria-hidden />
      ) : status === "missing" ? (
        <CloudOff className={cn(classes, "text-muted-foreground/70")} aria-hidden />
      ) : status === "in_progress" ? (
        <ProgressRing
          fraction={
            lesson.duration_seconds
              ? Math.min(lesson.watched_seconds / lesson.duration_seconds, 0.85)
              : 0.5
          }
          className={classes}
        />
      ) : (
        <Circle className={cn(classes, "text-muted-foreground/60")} aria-hidden />
      )}
      <span className="sr-only">{`${LABELS[status]}: `}</span>
    </>
  );
}

function ProgressRing({ fraction, className }: { fraction: number; className?: string }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(fraction, 0.15) * circumference;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("text-amber-600 dark:text-amber-400", className)}
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Small "Nova" pill for lessons added by a sync and never opened. */
export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-sky-100 px-1.5 py-px text-[0.6875rem] font-semibold text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
        className,
      )}
    >
      Nova
    </span>
  );
}

/** The star shown next to favorite lessons in lists. */
export function StarMark({ className }: { className?: string }) {
  return (
    <Star
      className={cn("size-3.5 shrink-0 fill-amber-400 text-amber-500", className)}
      aria-label="Favorita"
    />
  );
}

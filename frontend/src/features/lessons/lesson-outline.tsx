"use client";

import { CheckCircle2, ChevronDown, Circle, CloudOff, PlayCircle } from "lucide-react";
import Link from "next/link";
import { Accordion } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Progress } from "@/components/ui/progress";
import type { CourseDetail } from "@/features/courses/api";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

import { lessonPath } from "./api";

type Props = {
  course: CourseDetail;
  currentLessonId: number;
  /** Called when a lesson link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
  className?: string;
};

/** Course modules and lessons for the player sidebar/drawer; the current lesson is highlighted. */
export function LessonOutline({ course, currentLessonId, onNavigate, className }: Props) {
  const modules = course.modules.filter((module) => !module.is_hidden);
  const currentModuleId = modules.find((module) =>
    module.lessons.some((lesson) => lesson.id === currentLessonId),
  )?.id;
  const [open, setOpen] = useState<string[]>(
    currentModuleId == null ? [] : [String(currentModuleId)],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Following "next" into another module opens it.
  useEffect(() => {
    if (currentModuleId == null) return;
    const id = String(currentModuleId);
    setOpen((previous) => (previous.includes(id) ? previous : [...previous, id]));
  }, [currentModuleId]);

  // Keep the current lesson in view inside the scrollable list (not the whole page).
  useEffect(() => {
    const container = scrollRef.current;
    const current = container?.querySelector<HTMLElement>("[aria-current=page]");
    if (!container || !current) return;
    const top = current.offsetTop; // the container is the offsetParent (relative)
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - 48) {
      container.scrollTop = Math.max(top - container.clientHeight / 3, 0);
    }
  }, [currentLessonId, open]);

  const { progress } = course;

  return (
    <nav aria-label="Aulas do curso" className={cn("flex min-h-0 flex-col", className)}>
      <div className="grid gap-2 border-b px-4 pt-1 pb-4">
        <Link
          href={`/courses/${course.id}`}
          onClick={onNavigate}
          className="line-clamp-2 rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {course.title}
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Progress
            value={progress.percent}
            className="h-1.5 flex-1"
            aria-label={`${progress.percent}% do curso concluído`}
          />
          <span className="tabular-nums">
            {progress.lessons_completed}/{progress.lessons_total}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
      >
        <Accordion.Root type="multiple" value={open} onValueChange={setOpen}>
          {modules.map((module) => {
            const lessons = module.lessons.filter((lesson) => !lesson.is_hidden);
            return (
              <Accordion.Item key={module.id} value={String(module.id)}>
                <Accordion.Header>
                  <Accordion.Trigger className="group flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                    <span className="min-w-0 flex-1 leading-snug">{module.title}</span>
                    <span className="mt-0.5 shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                      {module.progress.lessons_completed}/{module.progress.lessons_total}
                    </span>
                    <ChevronDown
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                      aria-hidden
                    />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="overflow-hidden data-open:animate-accordion-down data-closed:animate-accordion-up">
                  <ol className="grid pb-2">
                    {lessons.map((lesson) => {
                      const current = lesson.id === currentLessonId;
                      const Icon = lesson.completed
                        ? CheckCircle2
                        : current
                          ? PlayCircle
                          : lesson.missing_in_drive
                            ? CloudOff
                            : Circle;
                      return (
                        <li key={lesson.id}>
                          <Link
                            href={lessonPath(course.id, lesson.id)}
                            onClick={onNavigate}
                            aria-current={current ? "page" : undefined}
                            className={cn(
                              "flex min-h-11 items-start gap-2.5 border-l-2 border-transparent py-2 pr-4 pl-[0.875rem] text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                              current && "border-primary bg-muted font-medium",
                              lesson.missing_in_drive && !current && "text-muted-foreground",
                            )}
                          >
                            <Icon
                              className={cn(
                                "mt-0.5 size-4 shrink-0",
                                lesson.completed
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : current
                                    ? "text-foreground"
                                    : "text-muted-foreground/70",
                              )}
                              aria-hidden
                            />
                            <span className="sr-only">
                              {lesson.completed ? "Concluída: " : ""}
                              {lesson.missing_in_drive ? "Fora do Drive: " : ""}
                            </span>
                            <span className="line-clamp-2 min-w-0 flex-1 leading-snug">
                              {lesson.title}
                            </span>
                            {lesson.duration_seconds != null && (
                              <span className="mt-0.5 shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                                {formatClock(lesson.duration_seconds)}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </Accordion.Content>
              </Accordion.Item>
            );
          })}
        </Accordion.Root>
      </div>
    </nav>
  );
}

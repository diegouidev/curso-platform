"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CloudOff,
  NotebookPen,
  PlayCircle,
} from "lucide-react";
import Link from "next/link";
import { Accordion } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Progress } from "@/components/ui/progress";
import type { CourseDetail, LessonSummary } from "@/features/courses/api";
import { groupBySection, sectionProgress } from "@/features/courses/sections";
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
  // Modules without visible lessons (e.g. an empty "Geral") are noise in the player.
  const modules = course.modules
    .filter((module) => !module.is_hidden)
    .map((module) => {
      const lessons = module.lessons.filter((lesson) => !lesson.is_hidden);
      return { module, lessons, groups: groupBySection(lessons) };
    })
    .filter(({ lessons }) => lessons.length > 0);
  const isCurrent = (lesson: LessonSummary) => lesson.id === currentLessonId;
  const current = modules.find(({ lessons }) => lessons.some(isCurrent));
  const currentModuleId = current?.module.id;
  const currentSection = current?.groups.find(
    (group) => group.title && group.lessons.some(isCurrent),
  );
  const currentSectionKey = currentSection?.key;

  const [open, setOpen] = useState<string[]>(
    currentModuleId == null ? [] : [String(currentModuleId)],
  );
  // Section keys are lesson ids, unique across modules: one list serves every module.
  const [openSections, setOpenSections] = useState<string[]>(
    currentSectionKey == null ? [] : [currentSectionKey],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Following "next" into another module or section opens it.
  useEffect(() => {
    if (currentModuleId == null) return;
    const id = String(currentModuleId);
    setOpen((previous) => (previous.includes(id) ? previous : [...previous, id]));
  }, [currentModuleId]);
  useEffect(() => {
    if (currentSectionKey == null) return;
    setOpenSections((previous) =>
      previous.includes(currentSectionKey) ? previous : [...previous, currentSectionKey],
    );
  }, [currentSectionKey]);

  // Keep the current lesson in view inside the scrollable list (not the whole page).
  useEffect(() => {
    const container = scrollRef.current;
    const current = container?.querySelector<HTMLElement>("[aria-current=page]");
    if (!container || !current) return;
    const top = current.offsetTop; // the container is the offsetParent (relative)
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - 48) {
      container.scrollTop = Math.max(top - container.clientHeight / 3, 0);
    }
  }, [currentLessonId, open, openSections]);

  const { progress } = course;
  const links = (lessons: LessonSummary[], nested = false) => (
    <LessonLinks
      courseId={course.id}
      lessons={lessons}
      currentLessonId={currentLessonId}
      onNavigate={onNavigate}
      nested={nested}
    />
  );

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
          {modules.map(({ module, lessons, groups }) => (
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
                {groups.some((group) => group.title) ? (
                  <Accordion.Root
                    type="multiple"
                    value={openSections}
                    onValueChange={setOpenSections}
                    className="pb-2"
                  >
                    {groups.map((group) => {
                      if (!group.title) return <div key={group.key}>{links(group.lessons)}</div>;
                      const section = sectionProgress(group.lessons);
                      return (
                        <Accordion.Item key={group.key} value={group.key}>
                          <Accordion.Header>
                            <Accordion.Trigger className="group flex w-full items-start gap-2 py-2 pr-4 pl-6 text-left text-xs font-medium outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                              <ChevronRight
                                className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 leading-4">{group.title}</span>
                              <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
                                {section.completed}/{section.total}
                              </span>
                            </Accordion.Trigger>
                          </Accordion.Header>
                          <Accordion.Content className="overflow-hidden data-open:animate-accordion-down data-closed:animate-accordion-up">
                            {links(group.lessons, true)}
                          </Accordion.Content>
                        </Accordion.Item>
                      );
                    })}
                  </Accordion.Root>
                ) : (
                  <div className="pb-2">{links(lessons)}</div>
                )}
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>
    </nav>
  );
}

function LessonLinks({
  courseId,
  lessons,
  currentLessonId,
  onNavigate,
  nested,
}: {
  courseId: number;
  lessons: LessonSummary[];
  currentLessonId: number;
  onNavigate?: () => void;
  /** Inside a section: indented under its title. */
  nested: boolean;
}) {
  return (
    <ol className="grid">
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
              href={lessonPath(courseId, lesson.id)}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-start gap-2.5 border-l-2 border-transparent py-2 pr-4 pl-[0.875rem] text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                nested && "pl-[1.375rem]",
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
              <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{lesson.title}</span>
              {lesson.has_note && (
                <NotebookPen
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Tem anotação"
                />
              )}
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
  );
}

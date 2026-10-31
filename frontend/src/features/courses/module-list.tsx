import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CloudOff,
  NotebookPen,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { lessonPath } from "@/features/lessons/api";
import { AttachmentList } from "@/features/lessons/attachment-list";
import { formatClock, formatDuration, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { LessonSummary, Module } from "./api";
import { groupBySection, sectionLabel, sectionProgress, type LessonGroup } from "./sections";

export function ModuleList({ courseId, modules }: { courseId: number; modules: Module[] }) {
  const visible = modules.filter((module) => !module.is_hidden);
  const firstOpen = visible.find((m) => m.progress.lessons_completed < m.progress.lessons_total);

  return (
    <Accordion
      type="multiple"
      defaultValue={firstOpen ? [String(firstOpen.id)] : []}
      className="overflow-hidden rounded-xl border"
    >
      {visible.map((module) => (
        <ModuleItem key={module.id} courseId={courseId} module={module} />
      ))}
    </Accordion>
  );
}

function ModuleItem({ courseId, module }: { courseId: number; module: Module }) {
  const lessons = module.lessons.filter((lesson) => !lesson.is_hidden);
  const { progress } = module;
  const done = progress.lessons_total > 0 && progress.lessons_completed === progress.lessons_total;

  return (
    <AccordionItem value={String(module.id)} className="border-b last:border-b-0">
      <AccordionTrigger className="gap-4 px-4 py-4 hover:no-underline sm:px-5">
        <div className="grid flex-1 gap-2 text-left">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {module.title}
            {module.missing_in_drive && <MissingBadge />}
          </span>
          <span className="flex items-center gap-3 text-xs font-normal text-muted-foreground">
            <span className="tabular-nums">
              {progress.lessons_total || !module.attachments.length
                ? `${progress.lessons_completed}/${progress.lessons_total} aulas`
                : plural(module.attachments.length, "material", "materiais")}
            </span>
            {progress.has_durations && (
              <span>{formatDuration(progress.duration_total_seconds)}</span>
            )}
            <Progress
              value={progress.percent}
              className={cn("hidden h-1.5 max-w-40 sm:block", done && "[&>*]:bg-emerald-600")}
              aria-label={`${progress.percent}% do módulo concluído`}
            />
          </span>
        </div>
      </AccordionTrigger>
      {/* h-auto: the default height is fixed when the module opens, which would clip a
          section opened afterwards. */}
      <AccordionContent className="h-auto pb-2">
        {lessons.some((lesson) => lesson.section) ? (
          <SectionList courseId={courseId} module={module} lessons={lessons} />
        ) : (
          <>
            <ul className="grid grid-cols-1">
              {lessons.map((lesson) => (
                <LessonRow key={lesson.id} courseId={courseId} lesson={lesson} />
              ))}
            </ul>
            {lessons.length === 0 && (
              <p className="px-5 py-3 text-sm text-muted-foreground">Nenhuma aula neste módulo.</p>
            )}
            {module.attachments.length > 0 && (
              <div className="mx-4 mt-2 grid gap-1 border-t pt-3 sm:mx-5">
                <p className="text-xs font-medium text-muted-foreground">Materiais do módulo</p>
                <AttachmentList attachments={module.attachments} />
              </div>
            )}
          </>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

/** Lessons grouped by the Drive sub-folders below the module, each one collapsible. */
function SectionList({
  courseId,
  module,
  lessons,
}: {
  courseId: number;
  module: Module;
  lessons: LessonSummary[];
}) {
  const groups = groupBySection(lessons);
  const firstOpen = groups.find((group) => {
    const progress = sectionProgress(group.lessons);
    return group.title && progress.completed < progress.total;
  });

  return (
    <AccordionPrimitive.Root
      type="multiple"
      defaultValue={firstOpen ? [firstOpen.key] : []}
      className="grid grid-cols-1 gap-2 px-3 pt-1 pb-2 sm:px-4"
    >
      {module.attachments.length > 0 && (
        <Collapsible
          value="materials"
          icon={Paperclip}
          title={`Materiais de apoio do módulo (${module.attachments.length})`}
        >
          <div className="border-t px-3 py-2 sm:px-4">
            <AttachmentList attachments={module.attachments} />
          </div>
        </Collapsible>
      )}
      {groups.map((group) =>
        group.title ? (
          <SectionItem key={group.key} courseId={courseId} group={group} />
        ) : (
          <ul key={group.key} className="grid grid-cols-1 overflow-hidden rounded-lg border">
            {group.lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                courseId={courseId}
                lesson={lesson}
                className="px-3 sm:px-4"
              />
            ))}
          </ul>
        ),
      )}
    </AccordionPrimitive.Root>
  );
}

function SectionItem({ courseId, group }: { courseId: number; group: LessonGroup<LessonSummary> }) {
  const progress = sectionProgress(group.lessons);

  return (
    <Collapsible
      value={group.key}
      label={group.number != null ? sectionLabel(group.number) : undefined}
      title={group.title}
      meta={
        <>
          {progress.done && (
            <CheckCircle2
              className="size-3.5 text-emerald-600 dark:text-emerald-400"
              aria-label="Seção concluída"
            />
          )}
          <span>
            {progress.completed}/{plural(progress.total, "aula", "aulas")}
          </span>
          {progress.durationSeconds != null && (
            <span>· {formatDuration(progress.durationSeconds)}</span>
          )}
        </>
      }
    >
      <ul className="grid grid-cols-1 border-t py-1">
        {group.lessons.map((lesson) => (
          <LessonRow key={lesson.id} courseId={courseId} lesson={lesson} className="px-3 sm:px-4" />
        ))}
      </ul>
    </Collapsible>
  );
}

/** A bordered, collapsible block inside a module (a section or the module materials). */
function Collapsible({
  value,
  label,
  icon: Icon,
  title,
  meta,
  children,
}: {
  value: string;
  label?: string;
  icon?: LucideIcon;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionPrimitive.Item value={value} className="overflow-hidden rounded-lg border">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="group flex w-full items-center gap-3 px-3 py-3 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4">
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {label && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase tabular-nums">
                  {label}
                </span>
              )}
              {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="truncate font-medium">{title}</span>
            </span>
            {meta && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums sm:ml-auto">
                {meta}
              </span>
            )}
          </span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden data-open:animate-accordion-down data-closed:animate-accordion-up">
        {children}
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

function LessonRow({
  courseId,
  lesson,
  className,
}: {
  courseId: number;
  lesson: LessonSummary;
  className?: string;
}) {
  return (
    <li>
      <Link
        href={lessonPath(courseId, lesson.id)}
        className={cn(
          "group flex items-center gap-3 px-4 py-2.5 text-sm no-underline! outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5",
          lesson.missing_in_drive && "text-muted-foreground",
          className,
        )}
      >
        {lesson.completed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground/60" />
        )}
        <span className="sr-only">{lesson.completed ? "Concluída:" : "Não concluída:"}</span>
        <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
        {lesson.missing_in_drive && <MissingBadge />}
        {lesson.has_note && (
          <NotebookPen
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label="Tem anotação"
          />
        )}
        {lesson.attachments.length > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3.5" aria-hidden />
            <span className="sr-only">Anexos:</span>
            {lesson.attachments.length}
          </span>
        )}
        {lesson.duration_seconds != null && (
          <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {formatClock(lesson.duration_seconds)}
          </span>
        )}
      </Link>
    </li>
  );
}

function MissingBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-xs font-normal text-muted-foreground">
      <CloudOff className="size-3" aria-hidden /> Fora do Drive
    </Badge>
  );
}

export function summarizeModules(modules: Module[]): string {
  const visible = modules.filter((m) => !m.is_hidden);
  const lessons = visible.reduce((total, m) => total + m.progress.lessons_total, 0);
  return `${plural(visible.length, "módulo", "módulos")} · ${plural(lessons, "aula", "aulas")}`;
}

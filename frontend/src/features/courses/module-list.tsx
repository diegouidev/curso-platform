import {
  CheckCircle2,
  Circle,
  CloudOff,
  ExternalLink,
  FileText,
  NotebookPen,
  Paperclip,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatClock, formatDuration, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { Attachment, LessonSummary, Module } from "./api";

// Until the in-app player lands (phase 4), lessons open in the Drive viewer.
const driveViewUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

export function ModuleList({ modules }: { modules: Module[] }) {
  const visible = modules.filter((module) => !module.is_hidden);
  const firstOpen = visible.find((m) => m.progress.lessons_completed < m.progress.lessons_total);

  return (
    <Accordion
      type="multiple"
      defaultValue={firstOpen ? [String(firstOpen.id)] : []}
      className="overflow-hidden rounded-xl border"
    >
      {visible.map((module) => (
        <ModuleItem key={module.id} module={module} />
      ))}
    </Accordion>
  );
}

function ModuleItem({ module }: { module: Module }) {
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
              {progress.lessons_completed}/{progress.lessons_total} aulas
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
      <AccordionContent className="pb-2">
        <ul className="grid">
          {lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </ul>
        {lessons.length === 0 && (
          <p className="px-5 py-3 text-sm text-muted-foreground">Nenhuma aula neste módulo.</p>
        )}
        {module.attachments.length > 0 && (
          <div className="mx-4 mt-2 grid gap-1 border-t pt-3 sm:mx-5">
            <p className="text-xs font-medium text-muted-foreground">Materiais do módulo</p>
            <AttachmentLinks attachments={module.attachments} />
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function LessonRow({ lesson }: { lesson: LessonSummary }) {
  return (
    <li>
      <a
        href={driveViewUrl(lesson.drive_file_id)}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5",
          lesson.missing_in_drive && "text-muted-foreground",
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
        <ExternalLink
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
        <span className="sr-only">(abre no Google Drive em nova aba)</span>
      </a>
    </li>
  );
}

function AttachmentLinks({ attachments }: { attachments: Attachment[] }) {
  return (
    <ul className="grid gap-1">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={attachment.view_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md py-1 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {attachment.title}
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        </li>
      ))}
    </ul>
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

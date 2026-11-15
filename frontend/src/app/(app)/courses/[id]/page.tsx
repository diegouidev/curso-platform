"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FolderSearch,
  Loader2,
  NotebookText,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeJobStats,
  isJobActive,
  useCourse,
  useMarkSeen,
  useSyncCourse,
  type CourseDetail,
} from "@/features/courses/api";
import { CourseActions } from "@/features/courses/course-actions";
import { CourseRecapCard } from "@/features/courses/course-recap";
import { ImportJobProgress } from "@/features/courses/import-job-progress";
import { ModuleList, summarizeModules } from "@/features/courses/module-list";
import { PlanCard } from "@/features/courses/plan-card";
import { TagList } from "@/features/courses/tags";
import { GOOGLE_ERROR_MESSAGES } from "@/features/google/api";
import { CourseContinueButton } from "@/features/lessons/continue-button";
import { ApiError } from "@/lib/api/client";
import { formatDuration, formatRelative } from "@/lib/format";

export default function CoursePage() {
  const id = Number(useParams<{ id: string }>().id);
  const { data: course, isPending, error, refetch } = useCourse(id);

  useEffect(() => {
    if (course) document.title = `${course.title} · Estudos`;
  }, [course]);

  if (isPending) return <CourseSkeleton />;
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <p>{notFound ? "Curso não encontrado." : "Não foi possível carregar o curso."}</p>
          {notFound ? (
            <Button asChild variant="outline">
              <Link href="/">Voltar para os cursos</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return <CourseView course={course} />;
}

function CourseView({ course }: { course: CourseDetail }) {
  const { progress, latest_job: job } = course;
  const syncing = isJobActive(job);
  const hasLessons = course.modules.some((module) => module.lessons.length > 0);
  const hiddenCount =
    course.modules.filter((module) => module.is_hidden).length +
    course.modules
      .filter((module) => !module.is_hidden)
      .reduce((total, module) => total + module.lessons.filter((l) => l.is_hidden).length, 0);
  const complete =
    progress.lessons_total > 0 && progress.lessons_completed === progress.lessons_total;

  return (
    <div className="grid grid-cols-1 gap-6 sm:gap-8">
      <JobFinishedToast course={course} />
      <div className="grid gap-4">
        <Link
          href="/"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Cursos
        </Link>
        <header className="grid grid-cols-1 gap-4 lg:flex lg:items-start lg:justify-between">
          <div className="grid min-w-0 gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
              {course.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {summarizeModules(course.modules)}
              {course.last_imported_at &&
                ` · sincronizado ${formatRelative(course.last_imported_at)}`}
            </p>
            {course.tags.length > 0 && <TagList tags={course.tags} />}
            {course.description && (
              <p className="mt-1 max-w-prose text-muted-foreground">{course.description}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
            {hasLessons && (
              <CourseContinueButton courseId={course.id} className="max-sm:h-11 max-sm:w-full" />
            )}
            <SyncButton courseId={course.id} disabled={syncing} />
            <Button asChild variant="ghost" className="max-sm:h-10">
              <Link href={`/courses/${course.id}/notebook`}>
                <NotebookText className="size-4" /> Caderno
              </Link>
            </Button>
            <Button asChild variant="ghost" className="max-sm:h-10">
              <a href={course.drive_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />{" "}
                <span className="max-sm:sr-only">Abrir no </span>
                Drive
              </a>
            </Button>
            <div className="ml-auto lg:ml-0">
              <CourseActions course={course} />
            </div>
          </div>
        </header>
      </div>

      {job && (syncing || job.status === "error") && <ImportJobProgress job={job} />}

      {course.new_lessons > 0 && <NewLessonsNotice course={course} />}

      {progress.lessons_total > 0 && (
        <section
          aria-label="Progresso do curso"
          className="grid gap-2 rounded-xl border p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{progress.percent}%</span>{" "}
              <span className="text-muted-foreground">concluído</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {progress.lessons_completed} de {progress.lessons_total} aulas
              {progress.has_durations &&
                progress.duration_remaining_seconds > 0 &&
                ` · ${formatDuration(progress.duration_remaining_seconds)} restantes`}
            </p>
          </div>
          <Progress
            value={progress.percent}
            aria-label={`${progress.percent}% do curso concluído`}
          />
        </section>
      )}

      {complete ? (
        <CourseRecapCard course={course} />
      ) : (
        progress.lessons_total > 0 && <PlanCard course={course} />
      )}

      {hasLessons ? (
        <div className="grid grid-cols-1 gap-3">
          <ModuleList courseId={course.id} modules={course.modules} />
          {hiddenCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {hiddenCount === 1 ? "1 item oculto." : `${hiddenCount} itens ocultos.`}{" "}
              <Link
                href={`/courses/${course.id}/organize`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Gerenciar em Organizar
              </Link>
            </p>
          )}
        </div>
      ) : (
        !syncing && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <FolderSearch className="size-6 text-muted-foreground" aria-hidden />
              <h2 className="font-medium">Nenhuma aula encontrada</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Não há vídeos nesta pasta ou nas subpastas. Se o conteúdo foi adicionado agora,
                sincronize de novo.
              </p>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}

function SyncButton({ courseId, disabled }: { courseId: number; disabled: boolean }) {
  const sync = useSyncCourse(courseId);
  const busy = disabled || sync.isPending;

  return (
    <Button
      variant="outline"
      disabled={busy}
      className="max-sm:h-10"
      onClick={() =>
        sync.mutate(undefined, {
          onError: (error) =>
            toast.error(
              (error instanceof ApiError && error.code && GOOGLE_ERROR_MESSAGES[error.code]) ||
                error.message,
            ),
        })
      }
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {busy ? "Sincronizando…" : "Sincronizar"}
    </Button>
  );
}

/** Lessons added by a sync since the notice was last dismissed, and not opened yet. */
function NewLessonsNotice({ course }: { course: CourseDetail }) {
  const markSeen = useMarkSeen(course.id);
  const count = course.new_lessons;

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-sky-600/30 bg-sky-50/70 p-4 text-sm sm:flex-row sm:items-center dark:bg-sky-400/5"
    >
      <p className="flex flex-1 items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <span>
          <span className="font-medium">
            {count === 1 ? "1 aula nova" : `${count} aulas novas`}
          </span>{" "}
          desde a última vez. Elas aparecem com a etiqueta “Nova” na lista.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="max-sm:h-9 sm:shrink-0"
        disabled={markSeen.isPending}
        onClick={() =>
          markSeen.mutate(undefined, {
            onError: () => toast.error("Não foi possível salvar."),
          })
        }
      >
        Marcar como vistas
      </Button>
    </div>
  );
}

/** Toast once when a job this page watched goes from running to finished. */
function JobFinishedToast({ course }: { course: CourseDetail }) {
  const job = course.latest_job;
  const watching = useRef<number | null>(null);

  useEffect(() => {
    if (!job) return;
    if (isJobActive(job)) {
      watching.current = job.id;
    } else if (watching.current === job.id) {
      watching.current = null;
      if (job.status === "success") toast.success(describeJobStats(job));
      else toast.error(job.error_message || "A sincronização falhou.");
    }
  }, [job]);

  return null;
}

function CourseSkeleton() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Carregando curso">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-px overflow-hidden rounded-xl border">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-none" />
        ))}
      </div>
    </div>
  );
}

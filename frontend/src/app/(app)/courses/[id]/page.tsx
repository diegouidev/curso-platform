"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FolderSearch,
  Loader2,
  RefreshCw,
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
  useSyncCourse,
  type CourseDetail,
} from "@/features/courses/api";
import { ImportJobProgress } from "@/features/courses/import-job-progress";
import { ModuleList, summarizeModules } from "@/features/courses/module-list";
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

  return (
    <div className="grid gap-8">
      <JobFinishedToast course={course} />
      <div className="grid gap-4">
        <Link
          href="/"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Cursos
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{course.title}</h1>
            <p className="text-sm text-muted-foreground">
              {summarizeModules(course.modules)}
              {course.last_imported_at &&
                ` · sincronizado ${formatRelative(course.last_imported_at)}`}
            </p>
            {course.description && (
              <p className="mt-2 max-w-prose text-muted-foreground">{course.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {hasLessons && <CourseContinueButton courseId={course.id} />}
            <SyncButton courseId={course.id} disabled={syncing} />
            <Button asChild variant="ghost">
              <a href={course.drive_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Abrir no Drive
              </a>
            </Button>
          </div>
        </header>
      </div>

      {job && (syncing || job.status === "error") && <ImportJobProgress job={job} />}

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

      {hasLessons ? (
        <ModuleList courseId={course.id} modules={course.modules} />
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

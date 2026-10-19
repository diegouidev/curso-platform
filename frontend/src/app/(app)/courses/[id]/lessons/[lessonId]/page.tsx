"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  EyeOff,
  ListVideo,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourse, type CourseDetail } from "@/features/courses/api";
import { useGoogleStatus } from "@/features/google/api";
import {
  lessonPath,
  prefetchLesson,
  usePreferences,
  useLesson,
  useSetCompleted,
  type LessonDetail,
  type LessonRef,
} from "@/features/lessons/api";
import { AttachmentList } from "@/features/lessons/attachment-list";
import { LessonOutline } from "@/features/lessons/lesson-outline";
import { LESSON_SHORTCUTS, useLessonShortcuts } from "@/features/lessons/use-lesson-shortcuts";
import { useTimeOnPage } from "@/features/lessons/use-time-on-page";
import { VideoPlayer } from "@/features/lessons/video-player";
import { withAuthUser } from "@/features/lessons/video-help";
import { NoteEditor } from "@/features/notes/note-editor";
import { ApiError } from "@/lib/api/client";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

const FOCUS_STORAGE_KEY = "player:focus-mode";

export default function LessonPage() {
  const params = useParams<{ id: string; lessonId: string }>();
  const courseId = Number(params.id);
  const lessonId = Number(params.lessonId);
  const router = useRouter();
  const lesson = useLesson(lessonId);
  const course = useCourse(courseId);
  const [focusMode, toggleFocusMode] = useFocusMode();

  // A lesson link with the wrong course id (moved lesson, old bookmark) lands on the right URL.
  const wrongCourse = lesson.data && lesson.data.course.id !== courseId;
  useEffect(() => {
    if (wrongCourse && lesson.data) {
      router.replace(lessonPath(lesson.data.course.id, lesson.data.id));
    }
  }, [wrongCourse, lesson.data, router]);

  if (lesson.isPending || wrongCourse) return <PlayerSkeleton />;
  if (lesson.isError) {
    const notFound = lesson.error instanceof ApiError && lesson.error.status === 404;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <p>{notFound ? "Aula não encontrada." : "Não foi possível carregar a aula."}</p>
          {notFound ? (
            <Button asChild variant="outline">
              <Link href={`/courses/${courseId}`}>Voltar para o curso</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void lesson.refetch()}>
              Tentar de novo
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <LessonPlayer
      // Remount per lesson: resets the player, the time counter and the suggestion.
      key={lesson.data.id}
      lesson={lesson.data}
      course={course.data}
      courseError={course.isError}
      focusMode={focusMode}
      onToggleFocusMode={toggleFocusMode}
    />
  );
}

type PlayerProps = {
  lesson: LessonDetail;
  course: CourseDetail | undefined;
  courseError: boolean;
  focusMode: boolean;
  onToggleFocusMode: () => void;
};

function LessonPlayer({ lesson, course, courseError, focusMode, onToggleFocusMode }: PlayerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const setCompleted = useSetCompleted(lesson);
  const { data: preferences } = usePreferences();
  const { data: google } = useGoogleStatus();

  const courseId = lesson.course.id;
  const completed = lesson.progress.completed;
  const playable = !lesson.missing_in_drive;

  useEffect(() => {
    document.title = `${lesson.title} · Estudos`;
  }, [lesson.title]);

  useEffect(() => {
    for (const neighbor of [lesson.next, lesson.previous]) {
      if (neighbor) void prefetchLesson(queryClient, neighbor.id);
    }
  }, [lesson.next, lesson.previous, queryClient]);

  const goTo = (target: LessonRef | null) => {
    if (target) router.push(lessonPath(courseId, target.id));
  };

  const markCompleted = (value: boolean) =>
    setCompleted.mutate(value, {
      onSuccess: () => {
        if (!value) return;
        toast.success("Aula concluída", {
          id: `completed-${lesson.id}`,
          description: lesson.next
            ? "Pressione N ou use o botão Próxima para seguir."
            : "Esta era a última aula do curso. 🎉",
          action: { label: "Desfazer", onClick: () => setCompleted.mutate(false) },
        });
      },
      onError: () => toast.error("Não foi possível salvar. Tente de novo."),
    });

  const toggleCompleted = () => markCompleted(!completed);

  const percent = preferences?.suggest_completion ? preferences.suggest_completion_percent : null;
  const thresholdSeconds =
    percent != null && lesson.duration_seconds ? (lesson.duration_seconds * percent) / 100 : null;

  useTimeOnPage({
    lessonId: lesson.id,
    enabled: playable,
    initialSeconds: lesson.progress.time_on_page_seconds,
    thresholdSeconds: completed ? null : thresholdSeconds,
    onThreshold: () => {
      toast("Marcar como concluída?", {
        id: `suggest-${lesson.id}`,
        description: `Você já passou ${percent}% da duração do vídeo nesta aula.`,
        duration: 20_000,
        action: { label: "Concluir", onClick: () => markCompleted(true) },
      });
    },
  });

  useLessonShortcuts({
    [LESSON_SHORTCUTS.complete]: toggleCompleted,
    [LESSON_SHORTCUTS.next]: () => goTo(lesson.next),
    [LESSON_SHORTCUTS.previous]: () => goTo(lesson.previous),
    [LESSON_SHORTCUTS.fullscreen]: () => {
      void iframeRef.current?.requestFullscreen?.().catch(() => undefined);
    },
    [LESSON_SHORTCUTS.focus]: onToggleFocusMode,
  });

  const hasMaterials = lesson.attachments.length > 0 || lesson.module_attachments.length > 0;
  const outline = course ? (
    <LessonOutline course={course} currentLessonId={lesson.id} className="h-full" />
  ) : courseError ? (
    <p className="p-4 text-sm text-muted-foreground">Não foi possível carregar as aulas.</p>
  ) : (
    <OutlineSkeleton />
  );

  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-6 lg:gap-8",
        !focusMode && "lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]",
      )}
    >
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <div className="flex items-center justify-between gap-3">
          <nav aria-label="Você está em" className="min-w-0 text-sm text-muted-foreground">
            <ol className="flex min-w-0 items-center gap-1">
              <li className="min-w-0">
                <Link
                  href={`/courses/${courseId}`}
                  className="block truncate rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {lesson.course.title}
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3.5" />
              </li>
              <li className="min-w-0 truncate">{lesson.module.title}</li>
            </ol>
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              className="max-sm:h-11 lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <ListVideo /> Aulas
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden lg:inline-flex"
              aria-pressed={focusMode}
              onClick={onToggleFocusMode}
            >
              {focusMode ? <PanelRightOpen /> : <PanelRightClose />}
              {focusMode ? "Mostrar aulas" : "Modo foco"}
            </Button>
          </div>
        </div>

        {playable ? (
          <VideoPlayer
            embedUrl={lesson.embed_url}
            driveUrl={lesson.drive_url}
            title={lesson.title}
            iframeRef={iframeRef}
          />
        ) : (
          <MissingInDrive driveUrl={withAuthUser(lesson.drive_url, google?.email)} />
        )}

        <section aria-labelledby="lesson-title" className="grid grid-cols-1 gap-4">
          <div className="grid gap-1.5">
            <h1
              id="lesson-title"
              className="text-xl font-semibold tracking-tight text-balance sm:text-2xl"
            >
              {lesson.title}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {lesson.position != null && (
                <span>
                  Aula {lesson.position} de {lesson.total}
                </span>
              )}
              {lesson.duration_seconds != null && (
                <span className="tabular-nums">· {formatClock(lesson.duration_seconds)}</span>
              )}
              {completed && (
                <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  · <CheckCircle2 className="size-3.5" aria-hidden /> Concluída
                </span>
              )}
              {lesson.is_hidden && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <EyeOff className="size-3" aria-hidden /> Oculta
                </Badge>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              variant={completed ? "outline" : "default"}
              aria-pressed={completed}
              onClick={toggleCompleted}
              className="max-sm:h-11 max-sm:flex-1"
            >
              {completed ? (
                <>
                  <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" /> Concluída
                </>
              ) : (
                <>
                  <Check /> Marcar como concluída
                </>
              )}
            </Button>
            <div className="flex gap-2 max-sm:w-full sm:ml-auto">
              <NeighborButton
                direction="previous"
                target={lesson.previous}
                courseId={courseId}
                className="max-sm:flex-1"
              />
              <NeighborButton
                direction="next"
                target={lesson.next}
                courseId={courseId}
                primary={completed}
                className="max-sm:flex-1"
              />
            </div>
          </div>

          <ShortcutHints />
        </section>

        {hasMaterials && (
          <section
            aria-labelledby="materiais"
            className="grid grid-cols-1 gap-3 rounded-xl border p-4"
          >
            <h2 id="materiais" className="text-sm font-medium">
              Materiais
            </h2>
            {lesson.attachments.length > 0 && <AttachmentList attachments={lesson.attachments} />}
            {lesson.module_attachments.length > 0 && (
              <div className="grid grid-cols-1 gap-1">
                <p className="px-2 text-xs font-medium text-muted-foreground">
                  Do módulo {lesson.module.title}
                </p>
                <AttachmentList attachments={lesson.module_attachments} />
              </div>
            )}
          </section>
        )}

        <NoteEditor lessonId={lesson.id} courseId={courseId} />
      </div>

      {!focusMode && (
        <aside className="sticky top-20 hidden h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-xl border bg-card pt-3 lg:flex">
          {outline}
        </aside>
      )}

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="gap-0 pt-12">
          <SheetHeader className="sr-only">
            <SheetTitle>Aulas do curso</SheetTitle>
          </SheetHeader>
          {course ? (
            <LessonOutline
              course={course}
              currentLessonId={lesson.id}
              onNavigate={() => setDrawerOpen(false)}
              className="h-full"
            />
          ) : (
            outline
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NeighborButton({
  direction,
  target,
  courseId,
  primary = false,
  className,
}: {
  direction: "previous" | "next";
  target: LessonRef | null;
  courseId: number;
  primary?: boolean;
  className?: string;
}) {
  const label = direction === "previous" ? "Anterior" : "Próxima";
  const content =
    direction === "previous" ? (
      <>
        <ChevronLeft /> {label}
      </>
    ) : (
      <>
        {label} <ChevronRight />
      </>
    );
  const classes = cn("max-sm:h-11", className);

  if (!target) {
    return (
      <Button size="lg" variant="outline" disabled className={classes}>
        {content}
      </Button>
    );
  }
  return (
    <Button size="lg" variant={primary ? "default" : "outline"} asChild className={classes}>
      <Link
        href={lessonPath(courseId, target.id)}
        title={`${target.module_title} · ${target.title}`}
        aria-label={`${label} aula: ${target.title}`}
      >
        {content}
      </Link>
    </Button>
  );
}

function ShortcutHints() {
  const items: [string, string][] = [
    [LESSON_SHORTCUTS.complete, "concluir"],
    [LESSON_SHORTCUTS.previous, "anterior"],
    [LESSON_SHORTCUTS.next, "próxima"],
    [LESSON_SHORTCUTS.fullscreen, "tela cheia"],
    [LESSON_SHORTCUTS.focus, "modo foco"],
  ];
  return (
    <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex">
      <span className="sr-only">Atalhos de teclado:</span>
      {items.map(([key, label]) => (
        <span key={key} className="flex items-center gap-1.5">
          <Kbd>{key.toUpperCase()}</Kbd> {label}
        </span>
      ))}
      <span>Depois de clicar no vídeo, clique fora dele para usar os atalhos.</span>
    </div>
  );
}

function MissingInDrive({ driveUrl }: { driveUrl: string }) {
  return (
    <div className="grid aspect-video place-items-center rounded-xl border border-dashed bg-muted/40 p-6 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <CloudOff className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Esta aula não está mais no Drive</h2>
        <p className="text-sm text-muted-foreground">
          O vídeo foi removido ou saiu da pasta do curso na última sincronização. Seu progresso e
          suas anotações continuam salvos.
        </p>
        <Button variant="outline" asChild>
          <a href={driveUrl} target="_blank" rel="noreferrer">
            Tentar abrir no Drive
          </a>
        </Button>
      </div>
    </div>
  );
}

/** Focus mode (sidebar hidden) is remembered per browser. */
function useFocusMode(): [boolean, () => void] {
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    try {
      setFocusMode(window.localStorage.getItem(FOCUS_STORAGE_KEY) === "1");
    } catch {
      // Storage blocked (private mode): just don't remember.
    }
  }, []);

  const toggle = useCallback(() => {
    setFocusMode((current) => {
      try {
        window.localStorage.setItem(FOCUS_STORAGE_KEY, current ? "0" : "1");
      } catch {
        // ignore
      }
      return !current;
    });
  }, []);

  return [focusMode, toggle];
}

function OutlineSkeleton() {
  return (
    <div className="grid gap-3 p-4" aria-busy="true" aria-label="Carregando aulas">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-1.5 w-full" />
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]"
      aria-busy="true"
      aria-label="Carregando aula"
    >
      <div className="grid gap-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="grid gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="ml-auto h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="hidden h-[32rem] rounded-xl lg:block" />
    </div>
  );
}

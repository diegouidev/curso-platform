"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ListTree,
  Loader2,
  NotebookPen,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotebook, type Notebook } from "@/features/courses/api";
import { useGoogleStatus } from "@/features/google/api";
import { lessonPath } from "@/features/lessons/api";
import { ApiError } from "@/lib/api/client";
import { downloadFile } from "@/lib/download";
import { plural } from "@/lib/format";
import { driveAtTime } from "@/lib/timestamps";

const updatedFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export default function NotebookPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { data, isPending, error, refetch } = useNotebook(id);

  useEffect(() => {
    if (data) document.title = `Caderno · ${data.course.title} · Estudos`;
  }, [data]);

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-3xl gap-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <p>{notFound ? "Curso não encontrado." : "Não foi possível carregar o caderno."}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <NotebookView notebook={data} />;
}

function NotebookView({ notebook }: { notebook: Notebook }) {
  const { course, modules } = notebook;
  const { data: google } = useGoogleStatus();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/api/export?type=md&course=${course.id}`, "anotacoes.md");
    } catch {
      toast.error("Não foi possível baixar as anotações.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-10">
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <Link
          href={`/courses/${course.id}`}
          className="flex w-fit max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">{course.title}</span>
        </Link>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground print:text-black">{course.title}</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Caderno de anotações
            </h1>
            <p className="text-sm text-muted-foreground print:hidden">
              {plural(notebook.notes, "aula com anotação", "aulas com anotação")}, na ordem do
              curso.
            </p>
          </div>
          {notebook.notes > 0 && (
            <div className="flex gap-2 print:hidden">
              <Button
                variant="outline"
                onClick={() => window.print()}
                className="max-sm:h-10 max-sm:flex-1"
              >
                <Printer /> Imprimir ou PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => void download()}
                disabled={downloading}
                className="max-sm:h-10 max-sm:flex-1"
              >
                {downloading ? <Loader2 className="animate-spin" /> : <Download />} Markdown
              </Button>
            </div>
          )}
        </header>

        {notebook.notes === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <NotebookPen className="size-6 text-muted-foreground" aria-hidden />
              <h2 className="font-medium">Nenhuma anotação neste curso ainda</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                O que você escrever em “Minhas anotações”, embaixo do vídeo de cada aula, aparece
                aqui em sequência.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {modules.length > 1 && (
              <details className="rounded-xl border p-4 lg:hidden print:hidden">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <ListTree className="size-4" aria-hidden /> Índice
                </summary>
                <Toc notebook={notebook} className="mt-3" />
              </details>
            )}
            {modules.map((module) => (
              <section
                key={module.id}
                id={`modulo-${module.id}`}
                aria-labelledby={`modulo-${module.id}-titulo`}
                className="grid scroll-mt-20 grid-cols-1 gap-4"
              >
                <h2
                  id={`modulo-${module.id}-titulo`}
                  className="border-b pb-2 text-lg font-semibold tracking-tight"
                >
                  {module.title}
                </h2>
                {module.lessons.map((lesson) => (
                  <article
                    key={lesson.id}
                    id={`aula-${lesson.id}`}
                    aria-labelledby={`aula-${lesson.id}-titulo`}
                    className="grid scroll-mt-20 break-inside-avoid-page grid-cols-1 gap-2 rounded-xl border p-4 sm:p-5 print:border-0 print:p-0"
                  >
                    <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 id={`aula-${lesson.id}-titulo`} className="font-medium">
                        <Link
                          href={lessonPath(course.id, lesson.id)}
                          className="underline-offset-4 hover:underline"
                        >
                          {lesson.section && (
                            <span className="text-muted-foreground">{lesson.section} · </span>
                          )}
                          {lesson.title}
                        </Link>
                        {lesson.completed && (
                          <CheckCircle2
                            className="ml-1.5 inline size-4 align-[-0.15em] text-emerald-600 dark:text-emerald-400"
                            aria-label="Concluída"
                          />
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Editada em {updatedFormat.format(new Date(lesson.updated_at))}
                      </p>
                    </header>
                    <Markdown
                      timestampHref={(seconds) =>
                        driveAtTime(lesson.drive_url, seconds, google?.email)
                      }
                    >
                      {lesson.content}
                    </Markdown>
                  </article>
                ))}
              </section>
            ))}
          </>
        )}
      </div>

      {modules.length > 1 && (
        <aside className="hidden lg:block print:hidden">
          <div className="sticky top-20 grid gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListTree className="size-4" aria-hidden /> Índice
            </p>
            <Toc notebook={notebook} />
          </div>
        </aside>
      )}
    </div>
  );
}

function Toc({ notebook, className }: { notebook: Notebook; className?: string }) {
  return (
    <nav aria-label="Índice do caderno" className={className}>
      <ol className="grid gap-1 text-sm">
        {notebook.modules.map((module) => (
          <li key={module.id}>
            <a
              href={`#modulo-${module.id}`}
              className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <span className="min-w-0 truncate">{module.title}</span>
              <span className="shrink-0 text-xs tabular-nums">{module.lessons.length}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

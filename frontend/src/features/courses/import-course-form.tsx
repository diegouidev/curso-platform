"use client";

import { FolderInput, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GOOGLE_ERROR_MESSAGES, GOOGLE_RECONNECT_CODES } from "@/features/google/api";
import { ApiError } from "@/lib/api/client";

import { useImportCourse, useImportJob, useSyncCourse } from "./api";
import { ImportJobProgress } from "./import-job-progress";

type Props = {
  onImported: (courseId: number) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function ImportCourseForm({ onImported, disabled, autoFocus }: Props) {
  const ids = { folder: useId(), clean: useId(), error: useId(), hint: useId() };
  const [folder, setFolder] = useState("");
  const [cleanTitles, setCleanTitles] = useState(true);
  const [started, setStarted] = useState<{ courseId: number; jobId: number } | null>(null);

  const importCourse = useImportCourse();
  const job = useImportJob(started?.jobId ?? null);
  const retry = useSyncCourse(started?.courseId ?? 0);

  useEffect(() => {
    if (started && job.data?.status === "success") onImported(started.courseId);
  }, [job.data?.status, started, onImported]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!folder.trim()) return;
    importCourse.mutate(
      { folder: folder.trim(), clean_titles: cleanTitles },
      { onSuccess: ({ course, job }) => setStarted({ courseId: course.id, jobId: job.id }) },
    );
  };

  const error = importCourse.error instanceof ApiError ? importCourse.error : null;
  const busy = importCourse.isPending || (job.data && job.data.status !== "error" && !!started);

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={ids.folder}>Link da pasta do curso no Google Drive</Label>
        <Input
          id={ids.folder}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://drive.google.com/drive/folders/…"
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
            importCourse.reset();
          }}
          disabled={disabled || !!busy}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={error ? ids.error : ids.hint}
        />
        {error ? (
          <ImportError id={ids.error} error={error} />
        ) : (
          <p id={ids.hint} className="text-sm text-muted-foreground">
            Cada subpasta vira um módulo e cada vídeo vira uma aula. PDFs e documentos entram como
            anexos.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id={ids.clean}
          checked={cleanTitles}
          onCheckedChange={(value) => setCleanTitles(value === true)}
          disabled={disabled || !!busy}
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <Label htmlFor={ids.clean} className="font-normal">
            Limpar títulos
          </Label>
          <p className="text-xs text-muted-foreground">
            Remove extensões, underscores e números de prefixo repetidos (ex.:
            “01_-_01_-_Aula_de_Python.mp4” vira “01 - Aula de Python”). Você pode editar qualquer
            título depois.
          </p>
        </div>
      </div>

      {job.data && <ImportJobProgress job={job.data} />}

      {job.data?.status === "error" && started ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(undefined, {
                onSuccess: (newJob) => setStarted({ ...started, jobId: newJob.id }),
              })
            }
          >
            {retry.isPending && <Loader2 className="size-4 animate-spin" />}
            Tentar de novo
          </Button>
          <Button asChild variant="outline">
            <Link href={`/courses/${started.courseId}`}>Abrir o curso mesmo assim</Link>
          </Button>
        </div>
      ) : (
        <Button
          type="submit"
          className="w-full sm:w-auto sm:justify-self-start"
          disabled={disabled || !folder.trim() || !!busy}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
          {busy ? "Importando…" : "Importar curso"}
        </Button>
      )}
    </form>
  );
}

function ImportError({ id, error }: { id: string; error: ApiError }) {
  const body = error.body as { course_id?: number } | undefined;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {(error.code && GOOGLE_ERROR_MESSAGES[error.code]) || error.message}{" "}
      {error.code === "course_exists" && body?.course_id && (
        <Link href={`/courses/${body.course_id}`} className="font-medium underline">
          Abrir o curso
        </Link>
      )}
      {error.code && GOOGLE_RECONNECT_CODES.has(error.code) && (
        <Link href="/settings" className="font-medium underline">
          Ir para Configurações
        </Link>
      )}
    </p>
  );
}

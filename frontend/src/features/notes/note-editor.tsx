"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { saveNote, useNote, type Note } from "./api";

const AUTOSAVE_DELAY_MS = 800;

type Props = { lessonId: number; courseId: number };

/** The lesson's markdown note: write/preview tabs, autosave with debounce. */
export function NoteEditor({ lessonId, courseId }: Props) {
  const { data, isPending, isError, refetch } = useNote(lessonId);

  return (
    <section aria-labelledby="anotacoes-titulo" id="anotacoes" className="grid grid-cols-1 gap-3">
      {isPending ? (
        <>
          <h2 id="anotacoes-titulo" className="text-base font-semibold">
            Minhas anotações
          </h2>
          <Skeleton className="h-40 w-full rounded-xl" />
        </>
      ) : isError ? (
        <>
          <h2 id="anotacoes-titulo" className="text-base font-semibold">
            Minhas anotações
          </h2>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border p-4 text-sm">
            <AlertTriangle className="size-4 text-destructive" aria-hidden />
            Não foi possível carregar a anotação.
            <Button variant="link" className="h-auto p-0" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          </div>
        </>
      ) : (
        <LoadedEditor lessonId={lessonId} courseId={courseId} initial={data} />
      )}
    </section>
  );
}

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

function LoadedEditor({ lessonId, courseId, initial }: Props & { initial: Note }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initial.content);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [status, setStatus] = useState<Status>("idle");
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const tabsId = useId();

  const contentRef = useRef(initial.content);
  const savedRef = useRef(initial.content);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  /** Saves serialized: whatever is current when a save starts wins, never an older value. */
  const saveNow = useCallback(() => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const value = contentRef.current;
      if (value === savedRef.current) {
        if (mounted.current) setStatus((s) => (s === "dirty" ? "saved" : s));
        return;
      }
      if (mounted.current) setStatus("saving");
      try {
        const note = await saveNote(queryClient, lessonId, courseId, value);
        savedRef.current = value;
        if (!mounted.current) return;
        setSavedAt(note.updated_at);
        setStatus(contentRef.current === value ? "saved" : "dirty");
      } catch {
        if (mounted.current) setStatus("error");
      }
    });
  }, [courseId, lessonId, queryClient]);

  const onChange = (value: string) => {
    setContent(value);
    contentRef.current = value;
    setStatus("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(saveNow, AUTOSAVE_DELAY_MS);
  };

  // Leaving the page or the lesson: send what's pending even if the page is going away.
  useEffect(() => {
    mounted.current = true;
    const flush = () => {
      if (contentRef.current === savedRef.current) return;
      window.clearTimeout(timer.current);
      void saveNote(queryClient, lessonId, courseId, contentRef.current, { keepalive: true })
        .then(() => {
          savedRef.current = contentRef.current;
        })
        .catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [courseId, lessonId, queryClient]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="anotacoes-titulo" className="text-base font-semibold">
          Minhas anotações
        </h2>
        <SaveStatus status={status} savedAt={savedAt} onRetry={saveNow} />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div
          role="tablist"
          aria-label="Modo do editor"
          className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5"
        >
          {(["write", "preview"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${tabsId}-${value}-tab`}
              aria-selected={tab === value}
              aria-controls={`${tabsId}-${value}`}
              onClick={() => setTab(value)}
              className={cn(
                "h-8 rounded-md px-3 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:h-10",
                tab === value && "bg-background font-medium text-foreground shadow-xs",
              )}
            >
              {value === "write" ? "Escrever" : "Visualizar"}
            </button>
          ))}
        </div>

        {tab === "write" ? (
          <div role="tabpanel" id={`${tabsId}-write`} aria-labelledby={`${tabsId}-write-tab`}>
            <textarea
              value={content}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => status === "dirty" && saveNow()}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  saveNow();
                }
              }}
              aria-labelledby="anotacoes-titulo"
              aria-describedby={`${tabsId}-hint`}
              placeholder="Escreva aqui o que quer lembrar desta aula…"
              spellCheck
              className="block field-sizing-content max-h-[70dvh] min-h-44 w-full resize-y bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            />
            <p id={`${tabsId}-hint`} className="border-t px-4 py-2 text-xs text-muted-foreground">
              Markdown: **negrito**, _itálico_, # título, - lista, - [ ] tarefa, `código`. Salva
              sozinho; Ctrl+S salva na hora.
            </p>
          </div>
        ) : (
          <div
            role="tabpanel"
            id={`${tabsId}-preview`}
            aria-labelledby={`${tabsId}-preview-tab`}
            className="min-h-44 p-4"
          >
            {content.trim() ? (
              <Markdown>{content}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Nada escrito ainda.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

function SaveStatus({
  status,
  savedAt,
  onRetry,
}: {
  status: Status;
  savedAt: string | null;
  onRetry: () => void;
}) {
  return (
    <p aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Salvando…
        </>
      ) : status === "dirty" ? (
        "Alterações não salvas"
      ) : status === "error" ? (
        <span className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="size-3.5" aria-hidden /> Não foi possível salvar.
          <Button variant="link" className="h-auto p-0 text-xs" onClick={onRetry}>
            Tentar de novo
          </Button>
        </span>
      ) : savedAt ? (
        <>
          <Check className="size-3.5" aria-hidden /> Salvo às {timeFormat.format(new Date(savedAt))}
        </>
      ) : null}
    </p>
  );
}

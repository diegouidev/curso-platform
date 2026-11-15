"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Layers, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/lib/format";
import { driveAtTime } from "@/lib/timestamps";
import { cn } from "@/lib/utils";

import { saveNote, useNote, type Note } from "./api";

const AUTOSAVE_DELAY_MS = 800;

type Props = {
  lessonId: number;
  courseId: number;
  /** Drive viewer of the lesson video: "[12:30]" in the preview opens it at that moment. */
  driveUrl?: string;
  googleEmail?: string | null;
};

/** The lesson's markdown note: write/preview tabs, autosave with debounce. */
export function NoteEditor({ lessonId, courseId, driveUrl, googleEmail }: Props) {
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
        <LoadedEditor
          lessonId={lessonId}
          courseId={courseId}
          driveUrl={driveUrl}
          googleEmail={googleEmail}
          initial={data}
        />
      )}
    </section>
  );
}

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

function LoadedEditor({
  lessonId,
  courseId,
  driveUrl,
  googleEmail,
  initial,
}: Props & { initial: Note }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initial.content);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [status, setStatus] = useState<Status>("idle");
  const [savedAt, setSavedAt] = useState(initial.updated_at);
  const [cards, setCards] = useState(initial.cards);
  const tabsId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        setCards(note.cards);
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

  /** Inserts "[00:00] " at the cursor with "00:00" selected, ready to type the time. */
  const insertTimestamp = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    textarea.focus();
    textarea.setRangeText("[00:00] ", start, end, "end");
    textarea.setSelectionRange(start + 1, start + 6);
    onChange(textarea.value);
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
      {cards > 0 && (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="size-3.5" aria-hidden />
          {plural(cards, "cartão de revisão", "cartões de revisão")} nesta anotação.
          <Link href="/review" className="underline underline-offset-4 hover:text-foreground">
            Revisar
          </Link>
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
          {/* Only the tabs live in the tablist; the timestamp button sits next to it. */}
          <div role="tablist" aria-label="Modo do editor" className="flex items-center gap-1">
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
          {tab === "write" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={insertTimestamp}
              className="ml-auto text-muted-foreground max-sm:h-10"
              title="Insere [00:00] para você digitar o tempo do vídeo"
            >
              <Clock aria-hidden /> Minutagem
            </Button>
          )}
        </div>

        {tab === "write" ? (
          <div role="tabpanel" id={`${tabsId}-write`} aria-labelledby={`${tabsId}-write-tab`}>
            <textarea
              ref={textareaRef}
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
              className="block field-sizing-content max-h-[70dvh] min-h-44 w-full resize-y bg-transparent p-4 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:text-sm"
            />
            <div
              id={`${tabsId}-hint`}
              className="grid gap-1 border-t px-4 py-2 text-xs text-muted-foreground"
            >
              <p>
                Markdown: **negrito**, _itálico_, # título, - lista, - [ ] tarefa, `código`. Salva
                sozinho; Ctrl+S salva na hora.
              </p>
              <p>
                <span className="font-medium text-foreground">[12:30]</span> vira um link para esse
                ponto do vídeo. Uma linha <span className="font-medium text-foreground">P:</span>{" "}
                seguida de <span className="font-medium text-foreground">R:</span> vira um cartão de
                revisão.
              </p>
            </div>
          </div>
        ) : (
          <div
            role="tabpanel"
            id={`${tabsId}-preview`}
            aria-labelledby={`${tabsId}-preview-tab`}
            className="min-h-44 p-4"
          >
            {content.trim() ? (
              <Markdown
                timestampHref={
                  driveUrl ? (seconds) => driveAtTime(driveUrl, seconds, googleEmail) : undefined
                }
              >
                {content}
              </Markdown>
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

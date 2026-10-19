"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  NotebookPen,
  PlayCircle,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { lessonPath } from "@/features/lessons/api";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type SearchResults = components["schemas"]["SearchResults"];

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

const SearchContext = createContext<{ open: () => void } | null>(null);

export function useSearch() {
  const context = useContext(SearchContext);
  if (!context) throw new Error("useSearch must be used inside <SearchProvider>");
  return context;
}

/** Global search, opened with Ctrl+K / ⌘K from anywhere in the app. */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Buscar</DialogTitle>
          <DialogDescription className="sr-only">
            Procure em cursos, aulas e no texto das suas anotações.
          </DialogDescription>
          {isOpen && <SearchPanel onDone={() => setIsOpen(false)} />}
        </DialogContent>
      </Dialog>
    </SearchContext.Provider>
  );
}

export function SearchButton() {
  const { open } = useSearch();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  return (
    <Button
      variant="outline"
      onClick={open}
      aria-label="Buscar (Ctrl+K)"
      className="w-9 justify-start gap-2 px-2.5 text-muted-foreground sm:w-56"
    >
      <Search />
      <span className="hidden flex-1 text-left sm:inline">Buscar…</span>
      <span className="hidden items-center gap-0.5 sm:flex">
        <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </Button>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SearchPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const enabled = debounced.length >= MIN_QUERY_LENGTH;

  const results = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => unwrap(api.GET("/api/search", { params: { query: { q: debounced } } })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    onDone();
    router.push(href);
  };

  const data = enabled ? results.data : undefined;
  const total = data ? data.courses.length + data.lessons.length + data.notes.length : 0;

  return (
    <Command shouldFilter={false} loop label="Busca global">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Buscar cursos, aulas e anotações…"
      />
      <CommandList>
        <SearchState
          query={query.trim()}
          enabled={enabled}
          loading={results.isFetching && !data}
          error={results.isError}
          empty={!!data && total === 0}
        />
        {data && total > 0 && <Results data={data} onSelect={go} fetching={results.isFetching} />}
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navegar <Kbd>Enter</Kbd> abrir
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> fechar
        </span>
      </div>
    </Command>
  );
}

function SearchState({
  query,
  enabled,
  loading,
  error,
  empty,
}: {
  query: string;
  enabled: boolean;
  loading: boolean;
  error: boolean;
  empty: boolean;
}) {
  const message = !enabled ? (
    query.length > 0 ? (
      "Digite pelo menos 2 letras."
    ) : (
      "Procure pelo nome de um curso ou de uma aula, ou por algo que você anotou."
    )
  ) : loading ? (
    <span className="flex items-center gap-2">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando…
    </span>
  ) : error ? (
    <span className="flex items-center gap-2">
      <AlertTriangle className="size-4 text-destructive" aria-hidden /> Não foi possível buscar.
      Tente de novo.
    </span>
  ) : empty ? (
    <>Nada encontrado para “{query}”.</>
  ) : null;

  if (!message) return null;
  return (
    <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

function Results({
  data,
  onSelect,
  fetching,
}: {
  data: SearchResults;
  onSelect: (href: string) => void;
  fetching: boolean;
}) {
  return (
    <div aria-busy={fetching}>
      {data.courses.length > 0 && (
        <CommandGroup heading="Cursos">
          {data.courses.map((course) => (
            <CommandItem
              key={course.id}
              value={`course-${course.id}`}
              onSelect={() => onSelect(`/courses/${course.id}`)}
            >
              <BookOpen className="mt-0.5 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{course.title}</span>
              {course.is_archived && (
                <span className="text-xs text-muted-foreground">Arquivado</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {data.lessons.length > 0 && (
        <>
          {data.courses.length > 0 && <CommandSeparator />}
          <CommandGroup heading="Aulas">
            {data.lessons.map((lesson) => (
              <CommandItem
                key={lesson.id}
                value={`lesson-${lesson.id}`}
                onSelect={() => onSelect(lessonPath(lesson.course_id, lesson.id))}
              >
                {lesson.completed ? (
                  <CheckCircle2
                    className="mt-0.5 text-emerald-600 dark:text-emerald-400"
                    aria-label="Concluída"
                  />
                ) : (
                  <PlayCircle className="mt-0.5 text-muted-foreground" aria-hidden />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{lesson.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {lesson.course_title} · {lesson.module_title}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
      {data.notes.length > 0 && (
        <>
          {(data.courses.length > 0 || data.lessons.length > 0) && <CommandSeparator />}
          <CommandGroup heading="Anotações">
            {data.notes.map((note) => (
              <CommandItem
                key={note.lesson_id}
                value={`note-${note.lesson_id}`}
                onSelect={() => onSelect(lessonPath(note.course_id, note.lesson_id))}
              >
                <NotebookPen className="mt-0.5 text-muted-foreground" aria-hidden />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate">{note.lesson_title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    <Highlighted
                      text={note.snippet}
                      start={note.match_start}
                      length={note.match_length}
                    />
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </div>
  );
}

function Highlighted({ text, start, length }: { text: string; start: number; length: number }) {
  if (!length) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30">
        {text.slice(start, start + length)}
      </mark>
      {text.slice(start + length)}
    </>
  );
}

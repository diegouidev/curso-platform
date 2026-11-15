"use client";

import { AlertTriangle, BookmarkCheck, CheckCircle2, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MARKS,
  lessonPath,
  useMarked,
  useUnmark,
  type MarkName,
  type MarkedLesson,
} from "@/features/lessons/api";
import { MARK_STYLES } from "@/features/lessons/lesson-marks";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "all" | MarkName;

const EMPTY: Record<Tab, string> = {
  all: "Nenhuma aula marcada ainda. Na página de uma aula, use Favorita, Rever depois ou Difícil.",
  starred: "Nenhuma aula favorita.",
  review_later: "Nada para rever depois.",
  difficult: "Nenhuma aula marcada como difícil.",
};

export default function MarkedPage() {
  const { data, isPending, isError, refetch } = useMarked();
  const [tab, setTab] = useState<Tab>("all");
  const tabsId = useId();

  useEffect(() => {
    document.title = "Marcadas · Estudos";
  }, []);

  const lessons = (data ?? []).filter((lesson) =>
    tab === "all" ? MARKS.some(({ name }) => lesson[name]) : lesson[tab],
  );
  const count = (name: Tab) =>
    (data ?? []).filter((lesson) =>
      name === "all" ? MARKS.some((mark) => lesson[mark.name]) : lesson[name],
    ).length;
  const tabs: { value: Tab; label: string }[] = [
    { value: "all", label: "Todas" },
    ...MARKS.map(({ name, plural }) => ({ value: name, label: plural })),
  ];

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Aulas marcadas</h1>
        <p className="text-sm text-muted-foreground">
          Suas favoritas, o que quer rever e o que achou difícil, de todos os cursos.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Filtrar marcações"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {tabs.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${tabsId}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${tabsId}-panel`}
            onClick={() => setTab(value)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
              tab === value &&
                "border-foreground bg-foreground text-background hover:text-background",
            )}
          >
            {label}
            {data && <span className="text-xs tabular-nums">{count(value)}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {isPending ? (
          <div className="grid gap-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertTriangle className="size-6 text-destructive" aria-hidden />
              <p>Não foi possível carregar as aulas marcadas.</p>
              <Button variant="outline" onClick={() => void refetch()}>
                Tentar de novo
              </Button>
            </CardContent>
          </Card>
        ) : lessons.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <BookmarkCheck className="size-6 text-muted-foreground" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{EMPTY[tab]}</p>
            </CardContent>
          </Card>
        ) : (
          <MarkedList lessons={lessons} tab={tab} />
        )}
      </div>
    </div>
  );
}

function MarkedList({ lessons, tab }: { lessons: MarkedLesson[]; tab: Tab }) {
  const groups: { courseId: number; title: string; lessons: MarkedLesson[] }[] = [];
  for (const lesson of lessons) {
    const last = groups.at(-1);
    if (last?.courseId === lesson.course_id) last.lessons.push(lesson);
    else groups.push({ courseId: lesson.course_id, title: lesson.course_title, lessons: [lesson] });
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {groups.map((group) => (
        <section key={group.courseId} aria-label={group.title} className="grid grid-cols-1 gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            <Link
              href={`/courses/${group.courseId}`}
              className="hover:text-foreground hover:underline"
            >
              {group.title}
            </Link>
          </h2>
          <ul className="grid overflow-hidden rounded-xl border">
            {group.lessons.map((lesson) => (
              <MarkedRow key={lesson.id} lesson={lesson} tab={tab} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MarkedRow({ lesson, tab }: { lesson: MarkedLesson; tab: Tab }) {
  const unmark = useUnmark();
  const marks = MARKS.filter(({ name }) => lesson[name]);

  return (
    <li className="flex items-center gap-1 border-b pr-1 last:border-b-0">
      <Link
        href={lessonPath(lesson.course_id, lesson.id)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {lesson.completed ? (
          <CheckCircle2
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-label="Concluída"
          />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        )}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate font-medium">{lesson.title}</span>
          <span className="truncate text-xs text-muted-foreground">
            {lesson.module_title}
            {lesson.section && ` · ${lesson.section}`}
            {lesson.duration_seconds != null && ` · ${formatClock(lesson.duration_seconds)}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {marks.map(({ name, label }) => {
            const { icon: Icon, active } = MARK_STYLES[name];
            return <Icon key={name} className={cn("size-4", active)} aria-label={label} />;
          })}
        </span>
      </Link>
      {tab !== "all" && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground max-sm:size-10"
          aria-label={`Tirar “${MARKS.find((m) => m.name === tab)?.label}” de ${lesson.title}`}
          disabled={unmark.isPending}
          onClick={() =>
            unmark.mutate(
              { id: lesson.id, mark: tab },
              { onError: () => toast.error("Não foi possível tirar a marcação.") },
            )
          }
        >
          <X />
        </Button>
      )}
    </li>
  );
}

"use client";

import { AlertTriangle, CalendarCheck, Eye, Layers, PartyPopper, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { lessonPath } from "@/features/lessons/api";
import {
  RATINGS,
  useAnswerCard,
  useInvalidateReview,
  useReview,
  type Rating,
  type ReviewCard,
  type ReviewSession,
} from "@/features/review/api";
import { formatLongDate, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ReviewPage() {
  const { data, isPending, isError, refetch } = useReview();

  useEffect(() => {
    document.title = "Revisar · Estudos";
  }, []);

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Revisar</h1>
        <p className="text-sm text-muted-foreground">
          Perguntas das suas anotações, na hora certa de lembrar de novo.
        </p>
      </header>
      {isPending ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-6 text-destructive" aria-hidden />
            <p>Não foi possível carregar a revisão.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : data.total === 0 ? (
        <NoCards />
      ) : data.due === 0 ? (
        <NothingDue session={data} />
      ) : (
        <ReviewSessionView session={data} />
      )}
    </div>
  );
}

function ReviewSessionView({ session }: { session: ReviewSession }) {
  // The queue is fixed when the page opens: refetches must not reshuffle the session.
  const [queue, setQueue] = useState<ReviewCard[]>(() => session.cards);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const answer = useAnswerCard();
  const invalidate = useInvalidateReview();
  const card = queue[0];
  const total = reviewed + queue.length;

  // Counters elsewhere (menu badge, dashboard) refresh when leaving the page.
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
  });
  useEffect(() => () => void invalidateRef.current(), []);

  const rate = useCallback(
    (rating: Rating) => {
      if (!card) return;
      answer.mutate(
        { id: card.id, rating },
        { onError: () => toast.error("Não foi possível salvar a resposta.") },
      );
      setQueue((current) => {
        const [first, ...rest] = current;
        // "Errei" comes back at the end of today's session.
        return rating === "again" && first ? [...rest, first] : rest;
      });
      if (rating !== "again") setReviewed((n) => n + 1);
      setRevealed(false);
    },
    [answer, card],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=dialog]")) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      const rating = revealed ? RATINGS.find((item) => item.key === event.key) : undefined;
      if (rating) {
        event.preventDefault();
        rate(rating.value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rate, revealed]);

  if (!card) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <PartyPopper className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <h2 className="text-lg font-medium">Revisão de hoje concluída</h2>
          <p className="text-sm text-muted-foreground">
            {plural(reviewed, "cartão revisado", "cartões revisados")}. Os próximos voltam no dia
            certo.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Voltar para os cursos</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Progress
          value={total ? (reviewed / total) * 100 : 0}
          className="h-1.5 flex-1"
          aria-label={`${reviewed} de ${total} cartões revisados`}
        />
        <span className="shrink-0 tabular-nums">
          {reviewed}/{total}
        </span>
      </div>

      <article
        aria-live="polite"
        className="grid min-h-64 grid-cols-1 content-start gap-4 rounded-xl border bg-card p-4 sm:p-6"
      >
        <p className="truncate text-xs text-muted-foreground">
          <Link
            href={lessonPath(card.lesson.course_id, card.lesson.id)}
            className="hover:text-foreground hover:underline"
          >
            {card.lesson.course_title} · {card.lesson.title}
          </Link>
          {card.repetitions === 0 && card.last_reviewed_at == null && (
            <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-px font-semibold text-sky-800 dark:bg-sky-400/15 dark:text-sky-300">
              Novo
            </span>
          )}
        </p>
        <h2 className="sr-only">Pergunta</h2>
        <Markdown className="text-base sm:text-lg">{card.question}</Markdown>
        {revealed && (
          <div className="grid grid-cols-1 gap-2 border-t pt-4">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Resposta
            </h2>
            <Markdown className="text-base">{card.answer}</Markdown>
          </div>
        )}
      </article>

      {revealed ? (
        <div className="grid gap-2">
          <p className="text-center text-sm text-muted-foreground">Como foi lembrar?</p>
          <div role="group" aria-label="Avaliar a resposta" className="grid grid-cols-4 gap-2">
            {RATINGS.map(({ value, label, key, hint }) => (
              <Button
                key={value}
                variant={value === "good" ? "default" : "outline"}
                onClick={() => rate(value)}
                aria-keyshortcuts={key}
                className={cn(
                  "h-auto flex-col gap-0.5 py-2.5 whitespace-normal",
                  value === "again" && "text-rose-700 dark:text-rose-300",
                )}
              >
                <span>{label}</span>
                <span className="text-[0.6875rem] font-normal">{hint}</span>
              </Button>
            ))}
          </div>
          <p className="hidden items-center justify-center gap-1.5 text-xs text-muted-foreground pointer-fine:flex">
            Teclas <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> <Kbd>4</Kbd>
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button size="lg" onClick={() => setRevealed(true)} className="h-11">
            <Eye /> Mostrar resposta
          </Button>
          <p className="hidden items-center justify-center gap-1.5 text-xs text-muted-foreground pointer-fine:flex">
            ou <Kbd>Espaço</Kbd>
          </p>
        </div>
      )}
      {queue.length > 1 && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <RotateCcw className="size-3.5" aria-hidden />
          “Errei” devolve o cartão para o fim da revisão de hoje.
        </p>
      )}
    </div>
  );
}

function NothingDue({ session }: { session: ReviewSession }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarCheck className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h2 className="text-lg font-medium">Nada para revisar hoje</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {session.reviewed_today > 0 &&
            `${plural(session.reviewed_today, "cartão revisado", "cartões revisados")} hoje. `}
          {session.next_due_on
            ? `Próxima revisão em ${formatLongDate(session.next_due_on)}.`
            : "Escreva mais perguntas nas suas anotações."}{" "}
          Você tem {plural(session.total, "cartão", "cartões")} no total.
        </p>
      </CardContent>
    </Card>
  );
}

function NoCards() {
  return (
    <Card className="border-dashed">
      <CardContent className="grid justify-items-center gap-4 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <Layers className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <h2 className="text-lg font-medium">Nenhum cartão ainda</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Nas anotações de uma aula, escreva uma pergunta numa linha começando com{" "}
          <strong>P:</strong> e a resposta na linha de baixo, com <strong>R:</strong>. Cada par vira
          um cartão, revisado em intervalos cada vez maiores.
        </p>
        <pre className="w-full max-w-sm rounded-lg bg-muted p-3 text-left text-sm whitespace-pre-wrap">
          {"P: O que é idempotência?\nR: Repetir a operação não muda o resultado."}
        </pre>
      </CardContent>
    </Card>
  );
}

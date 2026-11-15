"use client";

import { CalendarClock, Loader2, Target, TrendingUp } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration, formatLongDate, formatShortDate, parseDay, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useUpdateCourse, type CourseDetail, type CoursePlan } from "./api";

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const STATUS: Record<
  Exclude<CoursePlan["status"], "done" | "no_target">,
  { label: string; className: string }
> = {
  on_track: {
    label: "No ritmo",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
  },
  behind: {
    label: "Abaixo do ritmo",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300",
  },
  overdue: {
    label: "Prazo vencido",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300",
  },
};

/** "1,5 aula/dia · 25 min/dia" */
export function perDay(lessons: number | null, seconds: number | null): string {
  const parts: string[] = [];
  if (lessons != null)
    parts.push(`${decimal.format(lessons)} ${lessons === 1 ? "aula" : "aulas"}/dia`);
  if (seconds) parts.push(`${formatDuration(seconds)}/dia`);
  return parts.join(" · ");
}

/** One-line summary of the deadline for the course card on the dashboard. */
export function planSummary(plan: CoursePlan): { text: string; tone: string } | null {
  if (plan.status === "done" || plan.status === "no_target") return null;
  const status = STATUS[plan.status];
  const when =
    plan.status === "overdue"
      ? `venceu em ${formatShortDate(plan.target_date)}`
      : `até ${formatShortDate(plan.target_date)}`;
  return { text: `${status.label} · ${when}`, tone: status.className };
}

/** Deadline and pace: what's needed per day to finish on time, and when it ends at the
 * recent pace. */
export function PlanCard({ course }: { course: CourseDetail }) {
  const { plan } = course;
  const [editing, setEditing] = useState(false);
  if (plan.status === "done") return null;

  const pace = perDay(plan.pace_lessons_per_day || null, plan.pace_seconds_per_day || null);
  const projection = plan.projected_finish
    ? `${plan.pace_window_days === 1 ? "No ritmo de hoje" : `No ritmo dos últimos ${plan.pace_window_days} dias`}, você termina em ${formatLongDate(plan.projected_finish)}.`
    : "Conclua algumas aulas para ver quando você termina no seu ritmo.";

  return (
    <section
      aria-labelledby="prazo-titulo"
      className="grid grid-cols-1 gap-4 rounded-xl border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="prazo-titulo" className="flex flex-wrap items-center gap-2 font-medium">
            <Target className="size-4 text-muted-foreground" aria-hidden />
            {plan.target_date ? (
              <>Terminar até {formatLongDate(plan.target_date)}</>
            ) : (
              "Prazo para terminar"
            )}
            {plan.status !== "no_target" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  STATUS[plan.status].className,
                )}
              >
                {STATUS[plan.status].label}
              </span>
            )}
          </h2>
          {plan.status === "no_target" && (
            <p className="text-sm text-muted-foreground">
              Defina uma data e veja quanto precisa estudar por dia.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="max-sm:h-9">
          <CalendarClock /> {plan.target_date ? "Alterar prazo" : "Definir prazo"}
        </Button>
      </div>

      {plan.target_date && plan.days_left != null && (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Fact
            label="Tempo até o prazo"
            value={
              plan.days_left > 0
                ? plan.days_left === 1
                  ? "Só hoje"
                  : `${plan.days_left} dias`
                : `Venceu há ${Math.abs(plan.days_left) + 1} ${Math.abs(plan.days_left) === 0 ? "dia" : "dias"}`
            }
          />
          <Fact
            label="Precisa de"
            value={
              plan.days_left > 0
                ? perDay(plan.required_lessons_per_day, plan.required_seconds_per_day) || "—"
                : "—"
            }
          />
          <Fact label="Seu ritmo recente" value={pace || "Nada concluído ainda"} />
        </dl>
      )}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden />
        {projection}
      </p>

      <DeadlineDialog course={course} open={editing} onOpenChange={setEditing} />
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

const QUICK_PICKS = [
  { label: "1 semana", days: 7 },
  { label: "2 semanas", days: 14 },
  { label: "1 mês", days: 30 },
  { label: "3 meses", days: 91 },
];

function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function DeadlineDialog({
  course,
  open,
  onOpenChange,
}: {
  course: CourseDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateCourse(course.id);
  const [value, setValue] = useState(course.target_date ?? "");
  const inputId = useId();
  const today = todayIso();

  const save = (target: string | null) =>
    update.mutate(
      { target_date: target },
      {
        onSuccess: () => {
          toast.success(target ? "Prazo salvo." : "Prazo removido.");
          onOpenChange(false);
        },
        onError: () => toast.error("Não foi possível salvar o prazo."),
      },
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(course.target_date ?? "");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prazo para terminar</DialogTitle>
          <DialogDescription>
            A plataforma calcula quanto você precisa estudar por dia para chegar lá.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (value) save(value);
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Data</Label>
            <Input
              id={inputId}
              type="date"
              min={today}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="h-10"
              required
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Atalhos de data">
              {QUICK_PICKS.map(({ label, days }) => (
                <Button
                  key={days}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="max-sm:h-9"
                  onClick={() => setValue(addDays(today, days))}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            {course.target_date && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                disabled={update.isPending}
                onClick={() => save(null)}
              >
                Remover prazo
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending || !value}>
              {update.isPending && <Loader2 className="animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

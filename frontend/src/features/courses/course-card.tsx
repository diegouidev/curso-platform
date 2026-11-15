import { BookOpen, Clock, Loader2, Sparkles, Target } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDuration, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { isJobActive, type Course } from "./api";
import { planSummary } from "./plan-card";

export function CourseCard({ course }: { course: Course }) {
  const { progress } = course;
  const remaining = progress.lessons_total - progress.lessons_completed;
  const importing = isJobActive(course.latest_job);
  const plan = planSummary(course.plan);

  return (
    <Link
      href={`/courses/${course.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative grid aspect-video place-items-center bg-gradient-to-br from-muted to-muted/40">
        {course.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local uploads, no optimizer needed
          <img
            src={course.thumbnail_url}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <BookOpen className="size-10 text-muted-foreground/60" aria-hidden />
        )}
        {importing ? (
          <Badge variant="secondary" className="absolute top-3 left-3 gap-1">
            <Loader2 className="size-3 animate-spin" /> Importando
          </Badge>
        ) : (
          course.new_lessons > 0 && (
            <Badge className="absolute top-3 left-3 gap-1 bg-sky-700 text-white">
              <Sparkles className="size-3" aria-hidden />
              {course.new_lessons === 1 ? "1 aula nova" : `${course.new_lessons} aulas novas`}
            </Badge>
          )
        )}
        {course.is_archived && (
          <Badge variant="outline" className="absolute top-3 right-3 bg-background/80">
            Arquivado
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid gap-1.5">
          <h3 className="line-clamp-2 leading-snug font-medium group-hover:underline">
            {course.title}
          </h3>
          {course.tags.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {course.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-px text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {course.tags.length > 3 && (
                <span className="px-1 text-xs text-muted-foreground">
                  +{course.tags.length - 3}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="mt-auto grid gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {progress.lessons_total
                ? `${progress.lessons_completed} de ${progress.lessons_total} aulas`
                : importing
                  ? "Lendo o Drive…"
                  : "Nenhuma aula"}
            </span>
            <span className="font-medium text-foreground tabular-nums">{progress.percent}%</span>
          </div>
          <Progress value={progress.percent} aria-label={`${progress.percent}% concluído`} />
          {progress.lessons_total > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {remaining ? plural(remaining, "aula restante", "aulas restantes") : "Concluído 🎉"}
              </span>
              {progress.has_durations && remaining > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  {formatDuration(progress.duration_remaining_seconds)} restantes
                </span>
              )}
            </p>
          )}
          {plan && (
            <p
              className={cn(
                "flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                plan.tone,
              )}
            >
              <Target className="size-3" aria-hidden />
              {plan.text}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

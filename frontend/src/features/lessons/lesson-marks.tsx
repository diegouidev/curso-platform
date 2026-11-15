"use client";

import { Bookmark, Flag, Star, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { MARKS, useSetMarks, type LessonDetail, type MarkName } from "./api";

export const MARK_STYLES: Record<MarkName, { icon: LucideIcon; active: string }> = {
  starred: { icon: Star, active: "fill-amber-400 text-amber-500" },
  review_later: { icon: Bookmark, active: "fill-sky-500 text-sky-600 dark:text-sky-400" },
  difficult: { icon: Flag, active: "fill-rose-500 text-rose-600 dark:text-rose-400" },
};

/** Toggles for the lesson's own marks, listed together on the "Marcadas" page. */
export function LessonMarks({ lesson }: { lesson: LessonDetail }) {
  const setMarks = useSetMarks(lesson);

  return (
    <div role="group" aria-label="Marcar esta aula" className="flex flex-wrap gap-2">
      {MARKS.map(({ name, label }) => {
        const active = lesson.progress[name];
        const { icon: Icon, active: activeClass } = MARK_STYLES[name];
        return (
          <Button
            key={name}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={active}
            onClick={() =>
              setMarks.mutate(
                { [name]: !active },
                { onError: () => toast.error("Não foi possível salvar a marcação.") },
              )
            }
            className={cn("max-sm:h-10 max-sm:flex-1", active && "bg-muted")}
          >
            <Icon className={cn(active ? activeClass : "text-muted-foreground")} aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

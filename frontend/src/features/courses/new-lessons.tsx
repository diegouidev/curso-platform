"use client";

import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useMarkSeen, type Course } from "./api";

/** Dashboard notice: lessons the automatic (or manual) sync brought in, per course. */
export function NewLessonsNotice({ courses }: { courses: Course[] }) {
  const withNew = courses.filter((course) => !course.is_archived && course.new_lessons > 0);
  if (!withNew.length) return null;

  return (
    <section
      aria-labelledby="novidades-titulo"
      className="grid grid-cols-1 gap-2 rounded-xl border border-sky-600/30 bg-sky-50/70 p-4 dark:bg-sky-400/5"
    >
      <h2 id="novidades-titulo" className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-sky-600 dark:text-sky-400" aria-hidden />
        Aulas novas no Drive
      </h2>
      <ul className="grid grid-cols-1 gap-1">
        {withNew.map((course) => (
          <NewLessonsRow key={course.id} course={course} />
        ))}
      </ul>
    </section>
  );
}

function NewLessonsRow({ course }: { course: Course }) {
  const markSeen = useMarkSeen(course.id);

  return (
    <li className="flex items-center gap-2 text-sm">
      <Link
        href={`/courses/${course.id}`}
        className="min-w-0 flex-1 py-1.5 underline-offset-4 hover:underline"
      >
        <span className="font-medium">
          {course.new_lessons === 1 ? "1 aula nova" : `${course.new_lessons} aulas novas`}
        </span>{" "}
        em <span className="break-words">{course.title}</span>
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground max-sm:size-9"
        aria-label={`Marcar as aulas novas de ${course.title} como vistas`}
        title="Marcar como vistas"
        disabled={markSeen.isPending}
        onClick={() =>
          markSeen.mutate(undefined, { onError: () => toast.error("Não foi possível salvar.") })
        }
      >
        <X />
      </Button>
    </li>
  );
}

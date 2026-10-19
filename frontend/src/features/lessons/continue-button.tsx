"use client";

import { Play } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { lessonPath, useContinue, type ContinueResult } from "./api";

export const CONTINUE_LABELS: Record<NonNullable<ContinueResult["reason"]>, string> = {
  resume: "Continuar",
  next: "Próxima aula",
  start: "Começar",
};

/** Primary action of the course page: resume, move on, or start the course. */
export function CourseContinueButton({ courseId }: { courseId: number }) {
  const { data } = useContinue(courseId);
  if (!data?.lesson || !data.reason) return null;

  return (
    <Button asChild>
      <Link
        href={lessonPath(courseId, data.lesson.id)}
        aria-label={`${CONTINUE_LABELS[data.reason]}: ${data.lesson.title}`}
      >
        <Play /> {CONTINUE_LABELS[data.reason]}
      </Link>
    </Button>
  );
}

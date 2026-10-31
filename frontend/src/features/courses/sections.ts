import type { LessonSummary } from "./api";

export type LessonGroup<T> = {
  /** Stable while the lessons don't move: the id of the group's first lesson. */
  key: string;
  /** Drive sub-folder below the module; "" for lessons placed directly in the module folder. */
  title: string;
  /** 1-based, in order of appearance; null for lessons without a section. */
  number: number | null;
  lessons: T[];
};

/**
 * Splits a module's lessons into runs of the same section, keeping the lesson order (the
 * player's previous/next order). A section split by a custom order shows up twice.
 */
export function groupBySection<T extends Pick<LessonSummary, "id" | "section">>(
  lessons: T[],
): LessonGroup<T>[] {
  const groups: LessonGroup<T>[] = [];
  const numbers = new Map<string, number>();
  for (const lesson of lessons) {
    const last = groups[groups.length - 1];
    if (last && last.title === lesson.section) {
      last.lessons.push(lesson);
      continue;
    }
    if (lesson.section && !numbers.has(lesson.section)) {
      numbers.set(lesson.section, numbers.size + 1);
    }
    groups.push({
      key: String(lesson.id),
      title: lesson.section,
      number: numbers.get(lesson.section) ?? null,
      lessons: [lesson],
    });
  }
  return groups;
}

/** Same rules as the module progress: hidden and missing lessons don't count. */
export function sectionProgress(lessons: LessonSummary[]) {
  const counted = lessons.filter((lesson) => !lesson.is_hidden && !lesson.missing_in_drive);
  const durations = counted.filter((lesson) => lesson.duration_seconds != null);
  const completed = counted.filter((lesson) => lesson.completed).length;
  return {
    total: counted.length,
    completed,
    done: counted.length > 0 && completed === counted.length,
    durationSeconds: durations.length
      ? durations.reduce((total, lesson) => total + (lesson.duration_seconds ?? 0), 0)
      : null,
  };
}

/** "Seção 01" */
export function sectionLabel(number: number): string {
  return `Seção ${String(number).padStart(2, "0")}`;
}

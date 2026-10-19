import { useQuery, type QueryClient } from "@tanstack/react-query";

import { courseKeys, type CourseDetail } from "@/features/courses/api";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Note = components["schemas"]["Note"];

export const noteKeys = {
  detail: (lessonId: number) => ["notes", lessonId] as const,
};

// Browsers reject keepalive requests with a body over 64 KiB.
const KEEPALIVE_MAX_CHARS = 60_000;

export function useNote(lessonId: number) {
  return useQuery({
    queryKey: noteKeys.detail(lessonId),
    queryFn: () =>
      unwrap(api.GET("/api/lessons/{id}/note", { params: { path: { id: lessonId } } })),
    staleTime: Infinity, // only this tab edits it; the editor keeps the cache current
  });
}

export async function saveNote(
  queryClient: QueryClient,
  lessonId: number,
  courseId: number,
  content: string,
  { keepalive = false } = {},
): Promise<Note> {
  const note = await unwrap(
    api.PUT("/api/lessons/{id}/note", {
      params: { path: { id: lessonId } },
      body: { content },
      keepalive: keepalive && content.length <= KEEPALIVE_MAX_CHARS,
    }),
  );
  queryClient.setQueryData(noteKeys.detail(lessonId), note);
  // The note indicator in the course page and the player outline.
  queryClient.setQueryData<CourseDetail>(courseKeys.detail(courseId), (course) =>
    course
      ? {
          ...course,
          modules: course.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.id === lessonId ? { ...lesson, has_note: content !== "" } : lesson,
            ),
          })),
        }
      : course,
  );
  return note;
}

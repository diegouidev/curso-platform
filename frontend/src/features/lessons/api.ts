import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { courseKeys, type CourseDetail, type LessonSummary } from "@/features/courses/api";
import { statsKeys } from "@/features/stats/api";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type LessonDetail = components["schemas"]["LessonDetail"];
export type LessonProgress = components["schemas"]["LessonProgress"];
export type LessonRef = components["schemas"]["LessonRef"];
export type ContinueLesson = components["schemas"]["ContinueLesson"];
export type ContinueResult = components["schemas"]["Continue"];
export type StudyPreferences = components["schemas"]["StudyPreferences"];
export type MarkedLesson = components["schemas"]["MarkedLesson"];
export type LessonMarks = Pick<LessonProgress, "starred" | "review_later" | "difficult">;
export type MarkName = keyof LessonMarks;

export const lessonKeys = {
  detail: (id: number) => ["lessons", id] as const,
  continueAll: ["continue"] as const,
  continue: (courseId?: number) => ["continue", courseId ?? "all"] as const,
  preferences: ["preferences"] as const,
  marked: ["marked"] as const,
};

export const MARKS: { name: MarkName; label: string; plural: string }[] = [
  { name: "starred", label: "Favorita", plural: "Favoritas" },
  { name: "review_later", label: "Rever depois", plural: "Rever depois" },
  { name: "difficult", label: "Difícil", plural: "Difíceis" },
];

export function lessonPath(courseId: number, lessonId: number): string {
  return `/courses/${courseId}/lessons/${lessonId}`;
}

const fetchLesson = (id: number) =>
  unwrap(api.GET("/api/lessons/{id}", { params: { path: { id } } }));

export function useLesson(id: number) {
  return useQuery({ queryKey: lessonKeys.detail(id), queryFn: () => fetchLesson(id) });
}

/** Warms the cache so previous/next opens instantly. GET has no side effects. */
export function prefetchLesson(queryClient: QueryClient, id: number): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: lessonKeys.detail(id),
    queryFn: () => fetchLesson(id),
  });
}

function patchLessonProgress(
  queryClient: QueryClient,
  id: number,
  progress: Partial<LessonProgress>,
) {
  queryClient.setQueryData<LessonDetail>(lessonKeys.detail(id), (lesson) =>
    lesson ? { ...lesson, progress: { ...lesson.progress, ...progress } } : lesson,
  );
}

function patchCourseLesson(
  queryClient: QueryClient,
  courseId: number,
  lessonId: number,
  patch: Partial<LessonSummary>,
) {
  queryClient.setQueryData<CourseDetail>(courseKeys.detail(courseId), (course) =>
    course
      ? {
          ...course,
          modules: course.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.id === lessonId ? { ...lesson, ...patch } : lesson,
            ),
          })),
        }
      : course,
  );
}

/** Mark/unmark a lesson as done. Optimistic: the check mark flips before the server answers. */
export function useSetCompleted(lesson: Pick<LessonDetail, "id" | "course">) {
  const queryClient = useQueryClient();
  const { id } = lesson;
  const courseId = lesson.course.id;

  return useMutation({
    mutationFn: (completed: boolean) =>
      unwrap(
        completed
          ? api.POST("/api/lessons/{id}/complete", { params: { path: { id } } })
          : api.DELETE("/api/lessons/{id}/complete", { params: { path: { id } } }),
      ),
    onMutate: async (completed) => {
      await queryClient.cancelQueries({ queryKey: lessonKeys.detail(id) });
      const previous = queryClient.getQueryData<LessonDetail>(lessonKeys.detail(id));
      patchLessonProgress(queryClient, id, { completed });
      patchCourseLesson(queryClient, courseId, id, { completed });
      return { previous };
    },
    onError: (_error, completed, context) => {
      if (context?.previous) queryClient.setQueryData(lessonKeys.detail(id), context.previous);
      patchCourseLesson(queryClient, courseId, id, { completed: !completed });
    },
    onSuccess: (progress) => patchLessonProgress(queryClient, id, progress),
    onSettled: () => {
      // Aggregated progress (course, modules, dashboard) and "continue" come from the server.
      void queryClient.invalidateQueries({ queryKey: courseKeys.all });
      void queryClient.invalidateQueries({ queryKey: lessonKeys.continueAll });
      void queryClient.invalidateQueries({ queryKey: statsKeys.all });
    },
  });
}

/**
 * Reports visible time on the lesson page. `keepalive` lets the request outlive the page
 * (tab closed, navigation), which sendBeacon can't do with the Bearer header.
 */
export async function sendHeartbeat(
  queryClient: QueryClient,
  id: number,
  seconds: number,
  { keepalive = false } = {},
): Promise<LessonProgress> {
  const progress = await unwrap(
    api.POST("/api/lessons/{id}/heartbeat", {
      params: { path: { id } },
      body: { seconds },
      keepalive,
    }),
  );
  patchLessonProgress(queryClient, id, progress);
  return progress;
}

export function useContinue(courseId?: number) {
  return useQuery({
    queryKey: lessonKeys.continue(courseId),
    queryFn: () =>
      unwrap(
        api.GET("/api/continue", {
          params: { query: courseId == null ? {} : { course: courseId } },
        }),
      ),
    staleTime: 0,
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: lessonKeys.preferences,
    queryFn: () => unwrap(api.GET("/api/preferences")),
    staleTime: 5 * 60_000,
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: components["schemas"]["PatchedStudyPreferencesRequest"]) =>
      unwrap(api.PATCH("/api/preferences", { body })),
    onSuccess: (preferences) => {
      queryClient.setQueryData(lessonKeys.preferences, preferences);
      // The goals are part of the dashboard stats.
      void queryClient.invalidateQueries({ queryKey: statsKeys.all, exact: true });
    },
  });
}

/** Star / "rever depois" / "difícil". Optimistic, like completing a lesson. */
export function useSetMarks(lesson: Pick<LessonDetail, "id" | "course">) {
  const queryClient = useQueryClient();
  const { id } = lesson;
  const courseId = lesson.course.id;

  return useMutation({
    mutationFn: (marks: Partial<LessonMarks>) =>
      unwrap(api.PATCH("/api/lessons/{id}/marks", { params: { path: { id } }, body: marks })),
    onMutate: async (marks) => {
      await queryClient.cancelQueries({ queryKey: lessonKeys.detail(id) });
      const previous = queryClient.getQueryData<LessonDetail>(lessonKeys.detail(id));
      patchLessonProgress(queryClient, id, marks);
      patchCourseLesson(queryClient, courseId, id, marks);
      return { previous };
    },
    onError: (_error, _marks, context) => {
      if (!context?.previous) return;
      queryClient.setQueryData(lessonKeys.detail(id), context.previous);
      const before = context.previous.progress;
      patchCourseLesson(queryClient, courseId, id, {
        starred: before.starred,
        review_later: before.review_later,
        difficult: before.difficult,
      });
    },
    onSuccess: (progress) => patchLessonProgress(queryClient, id, progress),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: lessonKeys.marked }),
  });
}

export function useMarked() {
  return useQuery({
    queryKey: lessonKeys.marked,
    queryFn: () => unwrap(api.GET("/api/marked")),
    staleTime: 0,
  });
}

/** Removes one mark from the "Marcadas" page (no lesson detail in the cache there). */
export function useUnmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mark }: { id: number; mark: MarkName }) =>
      unwrap(
        api.PATCH("/api/lessons/{id}/marks", {
          params: { path: { id } },
          body: { [mark]: false },
        }),
      ),
    onMutate: async ({ id, mark }) => {
      await queryClient.cancelQueries({ queryKey: lessonKeys.marked });
      const previous = queryClient.getQueryData<MarkedLesson[]>(lessonKeys.marked);
      queryClient.setQueryData<MarkedLesson[]>(lessonKeys.marked, (lessons) =>
        lessons?.map((lesson) => (lesson.id === id ? { ...lesson, [mark]: false } : lesson)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(lessonKeys.marked, context.previous);
    },
    onSettled: (_data, _error, { id }) => {
      void queryClient.invalidateQueries({ queryKey: lessonKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: courseKeys.all });
    },
  });
}

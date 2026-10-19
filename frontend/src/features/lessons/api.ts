import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { courseKeys, type CourseDetail } from "@/features/courses/api";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type LessonDetail = components["schemas"]["LessonDetail"];
export type LessonProgress = components["schemas"]["LessonProgress"];
export type LessonRef = components["schemas"]["LessonRef"];
export type ContinueLesson = components["schemas"]["ContinueLesson"];
export type ContinueResult = components["schemas"]["Continue"];
export type StudyPreferences = components["schemas"]["StudyPreferences"];

export const lessonKeys = {
  detail: (id: number) => ["lessons", id] as const,
  continueAll: ["continue"] as const,
  continue: (courseId?: number) => ["continue", courseId ?? "all"] as const,
  preferences: ["preferences"] as const,
};

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
  completed: boolean,
) {
  queryClient.setQueryData<CourseDetail>(courseKeys.detail(courseId), (course) =>
    course
      ? {
          ...course,
          modules: course.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.id === lessonId ? { ...lesson, completed } : lesson,
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
      patchCourseLesson(queryClient, courseId, id, completed);
      return { previous };
    },
    onError: (_error, completed, context) => {
      if (context?.previous) queryClient.setQueryData(lessonKeys.detail(id), context.previous);
      patchCourseLesson(queryClient, courseId, id, !completed);
    },
    onSuccess: (progress) => patchLessonProgress(queryClient, id, progress),
    onSettled: () => {
      // Aggregated progress (course, modules, dashboard) and "continue" come from the server.
      void queryClient.invalidateQueries({ queryKey: courseKeys.all });
      void queryClient.invalidateQueries({ queryKey: lessonKeys.continueAll });
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
    onSuccess: (preferences) => queryClient.setQueryData(lessonKeys.preferences, preferences),
  });
}

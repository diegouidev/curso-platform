import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  courseKeys,
  type CourseDetail,
  type LessonSummary,
  type Module,
} from "@/features/courses/api";
import { lessonKeys } from "@/features/lessons/api";
import { statsKeys } from "@/features/stats/api";
import { ApiError, api, apiFetch, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ItemUpdate = components["schemas"]["PatchedItemUpdateRequest"];

/** Hidden items change progress, navigation and "continue": refresh everything derived. */
function invalidateDerived(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: courseKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["lessons"] });
  void queryClient.invalidateQueries({ queryKey: lessonKeys.continueAll });
  void queryClient.invalidateQueries({ queryKey: statsKeys.all });
}

function patchCourse(
  queryClient: QueryClient,
  courseId: number,
  update: (course: CourseDetail) => CourseDetail,
) {
  queryClient.setQueryData<CourseDetail>(courseKeys.detail(courseId), (course) =>
    course ? update(course) : course,
  );
}

export function useUpdateModule(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ItemUpdate }) =>
      unwrap(api.PATCH("/api/modules/{id}", { params: { path: { id } }, body })),
    onSuccess: (module: Module) => {
      patchCourse(queryClient, courseId, (course) => ({
        ...course,
        modules: course.modules.map((m) => (m.id === module.id ? module : m)),
      }));
      invalidateDerived(queryClient);
    },
  });
}

export function useUpdateLesson(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ItemUpdate }) =>
      unwrap(api.PATCH("/api/lessons/{id}", { params: { path: { id } }, body })),
    onSuccess: (lesson: LessonSummary) => {
      patchCourse(queryClient, courseId, (course) => ({
        ...course,
        modules: course.modules.map((m) => ({
          ...m,
          lessons: m.lessons.map((l) => (l.id === lesson.id ? lesson : l)),
        })),
      }));
      invalidateDerived(queryClient);
    },
  });
}

type Reorder = { kind: "modules" | "lessons"; parentId: number; ids: number[] };

function applyOrder<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}

/** Drag-and-drop order. Optimistic: the list stays where it was dropped. */
export function useReorder(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, parentId, ids }: Reorder) =>
      unwrap(api.POST("/api/reorder", { body: { kind, parent_id: parentId, ids } })),
    onMutate: async ({ kind, parentId, ids }) => {
      await queryClient.cancelQueries({ queryKey: courseKeys.detail(courseId) });
      const previous = queryClient.getQueryData<CourseDetail>(courseKeys.detail(courseId));
      patchCourse(queryClient, courseId, (course) =>
        kind === "modules"
          ? { ...course, modules: applyOrder(course.modules, ids) }
          : {
              ...course,
              modules: course.modules.map((m) =>
                m.id === parentId ? { ...m, lessons: applyOrder(m.lessons, ids) } : m,
              ),
            },
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous)
        queryClient.setQueryData(courseKeys.detail(courseId), context.previous);
    },
    onSettled: () => invalidateDerived(queryClient),
  });
}

export function useResetOrder(courseId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/courses/{id}/reset-order", { params: { path: { id: courseId } } })),
    onSuccess: (course) => {
      queryClient.setQueryData(courseKeys.detail(courseId), course);
      invalidateDerived(queryClient);
    },
  });
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export function useCourseThumbnail(courseId: number) {
  const queryClient = useQueryClient();
  const onSuccess = (course: CourseDetail) => {
    queryClient.setQueryData(courseKeys.detail(courseId), course);
    void queryClient.invalidateQueries({ queryKey: courseKeys.all, exact: true });
    void queryClient.invalidateQueries({ queryKey: lessonKeys.continueAll });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return jsonOrThrow<CourseDetail>(
        await apiFetch(`/api/courses/${courseId}/thumbnail`, { method: "PUT", body }),
      );
    },
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: () =>
      unwrap(api.DELETE("/api/courses/{id}/thumbnail", { params: { path: { id: courseId } } })),
    onSuccess,
  });
  return { upload, remove };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Course = components["schemas"]["Course"];
export type CourseDetail = components["schemas"]["CourseDetail"];
export type Module = components["schemas"]["Module"];
export type LessonSummary = components["schemas"]["LessonSummary"];
export type Attachment = components["schemas"]["Attachment"];
export type ImportJob = components["schemas"]["ImportJob"];
export type Progress = components["schemas"]["Progress"];

export const courseKeys = {
  all: ["courses"] as const,
  detail: (id: number) => ["courses", id] as const,
  job: (id: number) => ["import-jobs", id] as const,
};

const POLL_MS = 1500;

export function isJobActive(job: ImportJob | null | undefined): boolean {
  return job?.status === "pending" || job?.status === "running";
}

export function useCourses() {
  return useQuery({
    queryKey: courseKeys.all,
    queryFn: () => unwrap(api.GET("/api/courses")),
    refetchInterval: (query) =>
      query.state.data?.some((course) => isJobActive(course.latest_job)) ? POLL_MS * 2 : false,
  });
}

export function useCourse(id: number) {
  return useQuery({
    queryKey: courseKeys.detail(id),
    queryFn: () => unwrap(api.GET("/api/courses/{id}", { params: { path: { id } } })),
    // Keep the page fresh while a sync runs in the background.
    refetchInterval: (query) => (isJobActive(query.state.data?.latest_job) ? POLL_MS : false),
  });
}

export function useImportJob(id: number | null) {
  return useQuery({
    queryKey: courseKeys.job(id ?? 0),
    queryFn: () => unwrap(api.GET("/api/import-jobs/{id}", { params: { path: { id: id ?? 0 } } })),
    enabled: id != null,
    refetchInterval: (query) => (isJobActive(query.state.data) ? POLL_MS : false),
  });
}

export function useImportCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { folder: string; clean_titles: boolean }) =>
      unwrap(api.POST("/api/courses/import", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: courseKeys.all }),
  });
}

export function useSyncCourse(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/courses/{id}/sync", { params: { path: { id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: courseKeys.all }),
  });
}

export function useUpdateCourse(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: components["schemas"]["PatchedCourseUpdateRequest"]) =>
      unwrap(api.PATCH("/api/courses/{id}", { params: { path: { id } }, body })),
    onSuccess: (course) => {
      queryClient.setQueryData(courseKeys.detail(id), course);
      void queryClient.invalidateQueries({ queryKey: courseKeys.all, exact: true });
    },
  });
}

/** "12 aulas novas · 2 removidas do Drive" summary for a finished job. */
export function describeJobStats(job: ImportJob): string {
  const s = job.stats;
  if (!s) return "";
  const parts: string[] = [];
  if (s.lessons_created) parts.push(`${s.lessons_created} aula(s) nova(s)`);
  if (s.lessons_updated) parts.push(`${s.lessons_updated} atualizada(s)`);
  if (s.lessons_restored) parts.push(`${s.lessons_restored} de volta ao Drive`);
  if (s.lessons_missing) parts.push(`${s.lessons_missing} não encontrada(s) no Drive`);
  if (s.modules_created) parts.push(`${s.modules_created} módulo(s) novo(s)`);
  return parts.length ? parts.join(" · ") : "Nenhuma mudança no Drive.";
}

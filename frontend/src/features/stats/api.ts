import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type StudyStats = components["schemas"]["StudyStats"];
export type StudyCalendar = components["schemas"]["StudyCalendar"];

export const statsKeys = { all: ["stats"] as const, calendar: ["stats", "calendar"] as const };

export function useStats() {
  return useQuery({
    queryKey: statsKeys.all,
    queryFn: () => unwrap(api.GET("/api/stats")),
    staleTime: 0,
  });
}

export function useCalendar() {
  return useQuery({
    queryKey: statsKeys.calendar,
    queryFn: () => unwrap(api.GET("/api/stats/calendar")),
    staleTime: 60_000,
  });
}

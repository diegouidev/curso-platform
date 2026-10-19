import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type StudyStats = components["schemas"]["StudyStats"];

export const statsKeys = { all: ["stats"] as const };

export function useStats() {
  return useQuery({
    queryKey: statsKeys.all,
    queryFn: () => unwrap(api.GET("/api/stats")),
    staleTime: 0,
  });
}

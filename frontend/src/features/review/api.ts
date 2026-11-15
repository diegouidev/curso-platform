import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ReviewSession = components["schemas"]["ReviewSession"];
export type ReviewCard = components["schemas"]["ReviewCard"];
export type Rating = components["schemas"]["ReviewRatingEnum"];

export const reviewKeys = { all: ["review"] as const };

export const RATINGS: { value: Rating; label: string; key: string; hint: string }[] = [
  { value: "again", label: "Errei", key: "1", hint: "volta hoje" },
  { value: "hard", label: "Difícil", key: "2", hint: "intervalo curto" },
  { value: "good", label: "Bom", key: "3", hint: "intervalo normal" },
  { value: "easy", label: "Fácil", key: "4", hint: "intervalo longo" },
];

/** Today's due cards (and the counters shown on the dashboard and in the menu). */
export function useReview() {
  return useQuery({
    queryKey: reviewKeys.all,
    queryFn: () => unwrap(api.GET("/api/review")),
    staleTime: 30_000,
  });
}

export function useAnswerCard() {
  return useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: Rating }) =>
      unwrap(api.POST("/api/review/cards/{id}", { params: { path: { id } }, body: { rating } })),
  });
}

export function useInvalidateReview() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: reviewKeys.all });
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { GOOGLE_ERROR_MESSAGES, googleKeys } from "./api";

/** Shows the outcome of the OAuth round-trip (?google=connected|error&reason=…) once. */
export function OAuthResultToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const result = params.get("google");
  const reason = params.get("reason");

  useEffect(() => {
    if (!result) return;
    if (result === "connected") {
      toast.success("Conta Google conectada.");
      void queryClient.invalidateQueries({ queryKey: googleKeys.status });
    } else {
      toast.error(GOOGLE_ERROR_MESSAGES[reason ?? ""] ?? "Não foi possível conectar ao Google.", {
        duration: 10_000,
      });
    }
    router.replace(pathname, { scroll: false });
  }, [result, reason, pathname, router, queryClient]);

  return null;
}

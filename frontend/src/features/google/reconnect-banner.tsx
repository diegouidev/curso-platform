"use client";

import { AlertTriangle } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

import { googleConnectUrl, useGoogleStatus } from "./api";

/** App-wide notice when Google rejected the stored refresh token. */
export function ReconnectBanner() {
  const { data } = useGoogleStatus();
  const pathname = usePathname();
  if (!data?.connected || !data.needs_reconnect) return null;

  return (
    <div
      role="alert"
      className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />A
        conexão com o Google expirou. Reconecte para importar e sincronizar cursos.
      </p>
      <Button asChild size="sm">
        <a href={googleConnectUrl(pathname)}>Reconectar Google</a>
      </Button>
    </div>
  );
}

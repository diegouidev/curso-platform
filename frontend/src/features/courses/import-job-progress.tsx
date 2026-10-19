"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";

import { describeJobStats, isJobActive, type ImportJob } from "./api";

export function ImportJobProgress({ job, className }: { job: ImportJob; className?: string }) {
  const active = isJobActive(job);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        job.status === "error" && "border-destructive/40 bg-destructive/5",
        job.status === "success" && "border-emerald-600/30 bg-emerald-600/5",
        className,
      )}
    >
      {active ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : job.status === "success" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="grid gap-0.5">
        <p className="font-medium">
          {active
            ? job.kind === "import"
              ? "Importando do Google Drive…"
              : "Sincronizando com o Google Drive…"
            : job.status === "success"
              ? job.kind === "import"
                ? "Importação concluída"
                : "Sincronização concluída"
              : "A importação falhou"}
        </p>
        <p className="text-muted-foreground">
          {job.status === "error"
            ? job.error_message
            : job.status === "success"
              ? describeJobStats(job)
              : job.folders_scanned
                ? `${plural(job.folders_scanned, "pasta lida", "pastas lidas")} · ${plural(job.files_found, "arquivo encontrado", "arquivos encontrados")}`
                : "Lendo a estrutura de pastas…"}
        </p>
      </div>
    </div>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileJson, FileText, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { plural } from "@/lib/format";

type RestoreStats = components["schemas"]["RestoreStats"];

async function download(type: "json" | "md") {
  const response = await apiFetch(`/api/export?type=${type}`);
  if (!response.ok) throw new ApiError(response.status, null);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename =
    /filename="([^"]+)"/.exec(disposition)?.[1] ?? (type === "md" ? "anotacoes.md" : "backup.json");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupCard() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<"json" | "md" | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<RestoreStats | null>(null);

  const exportAs = async (type: "json" | "md") => {
    setExporting(type);
    try {
      await download(type);
    } catch {
      toast.error("Não foi possível exportar.");
    } finally {
      setExporting(null);
    }
  };

  const restore = async (file: File) => {
    setImporting(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch("/api/import-backup", { method: "POST", body });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(response.status, data);
      setResult(data as RestoreStats);
      setPending(null);
      // Progress, notes, stats and preferences may all have changed.
      void queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Não foi possível importar.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meus dados</CardTitle>
        <CardDescription>
          Progresso, anotações, tempo de estudo e preferências. Os vídeos e a estrutura dos cursos
          vêm do Drive e não entram no backup.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <p className="text-sm font-medium">Exportar</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={exporting !== null}
              onClick={() => void exportAs("json")}
            >
              {exporting === "json" ? <Loader2 className="animate-spin" /> : <FileJson />}
              Backup completo (JSON)
            </Button>
            <Button
              variant="outline"
              disabled={exporting !== null}
              onClick={() => void exportAs("md")}
            >
              {exporting === "md" ? <Loader2 className="animate-spin" /> : <FileText />}
              Anotações (Markdown)
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Importar backup</p>
          <p className="text-sm text-muted-foreground">
            Use um arquivo JSON exportado aqui. Os cursos precisam estar importados nesta
            plataforma.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Arquivo de backup"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                setResult(null);
                setPending(file);
              }
            }}
          />
          <Button
            variant="outline"
            className="w-fit"
            disabled={importing}
            onClick={() => fileInput.current?.click()}
          >
            <Upload /> Escolher arquivo…
          </Button>
        </div>

        {result && <RestoreResult stats={result} />}
      </CardContent>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && !importing && setPending(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importar este backup?</DialogTitle>
            <DialogDescription className="break-all">{pending?.name}</DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            <li>Nada é apagado: aulas concluídas continuam concluídas.</li>
            <li>Em cada anotação, vale a versão editada por último.</li>
            <li>Tempo de estudo e sessões são somados sem duplicar.</li>
            <li>Importar o mesmo arquivo de novo não muda nada.</li>
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={importing}>
                Cancelar
              </Button>
            </DialogClose>
            <Button disabled={importing} onClick={() => pending && void restore(pending)}>
              {importing ? <Loader2 className="animate-spin" /> : <Download />} Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RestoreResult({ stats }: { stats: RestoreStats }) {
  return (
    <Alert role="status">
      <CheckCircle2 />
      <AlertTitle>Backup importado</AlertTitle>
      <AlertDescription className="grid gap-2">
        <p>
          {plural(stats.lessons_matched, "aula encontrada", "aulas encontradas")} ·{" "}
          {plural(stats.progress_updated, "progresso atualizado", "progressos atualizados")} ·{" "}
          {plural(stats.notes_restored, "anotação restaurada", "anotações restauradas")} ·{" "}
          {plural(stats.sessions_added, "sessão de estudo", "sessões de estudo")}
          {stats.preferences_restored ? " · preferências restauradas" : ""}
        </p>
        {stats.courses_not_found.length > 0 && (
          <p>
            Estes cursos ainda não foram importados aqui ({stats.lessons_not_found} aulas
            ignoradas). Importe-os e depois importe o backup de novo:{" "}
            <strong className="font-medium">{stats.courses_not_found.join(", ")}</strong>.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

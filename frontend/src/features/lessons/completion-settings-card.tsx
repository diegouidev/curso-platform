"use client";

import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { usePreferences, useUpdatePreferences, type StudyPreferences } from "./api";

const PERCENT_OPTIONS = [50, 60, 70, 75, 80, 85, 90, 95, 100];

export function CompletionSettingsCard() {
  const { data, isPending, isError, refetch } = usePreferences();
  const update = useUpdatePreferences();
  const switchId = useId();
  const selectId = useId();

  const save = (patch: Partial<StudyPreferences>) =>
    update.mutate(patch, {
      onSuccess: () => toast.success("Preferência salva."),
      onError: () => toast.error("Não foi possível salvar. Tente de novo."),
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conclusão automática</CardTitle>
        <CardDescription>
          O Drive não informa quanto do vídeo você assistiu. Por isso a plataforma conta o tempo com
          a aba da aula aberta e visível, e sugere marcar a aula como concluída. Ela nunca marca
          sozinha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-8 w-40" />
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle className="flex flex-wrap items-center gap-2">
              Não foi possível carregar a preferência.
              <Button variant="link" className="h-auto p-0" onClick={() => void refetch()}>
                Tentar de novo
              </Button>
            </AlertTitle>
          </Alert>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={switchId} className="leading-snug font-normal">
                Sugerir conclusão quando eu passar tempo suficiente na aula
              </Label>
              <Switch
                id={switchId}
                checked={data.suggest_completion}
                disabled={update.isPending}
                onCheckedChange={(checked) => save({ suggest_completion: checked })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor={selectId} className="font-normal text-muted-foreground">
                Sugerir depois de
              </Label>
              <select
                id={selectId}
                value={data.suggest_completion_percent}
                disabled={!data.suggest_completion || update.isPending}
                onChange={(event) =>
                  save({ suggest_completion_percent: Number(event.target.value) })
                }
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
              >
                {PERCENT_OPTIONS.map((percent) => (
                  <option key={percent} value={percent}>
                    {percent}%
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">da duração do vídeo</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Vale só para aulas cuja duração o Drive informa.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

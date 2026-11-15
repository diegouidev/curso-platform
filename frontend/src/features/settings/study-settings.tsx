"use client";

import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  usePreferences,
  useUpdatePreferences,
  type StudyPreferences,
} from "@/features/lessons/api";
import { ApiError, api, unwrap } from "@/lib/api/client";
import { formatDuration } from "@/lib/format";

const SELECT_CLASS =
  "h-10 rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:h-8 sm:text-sm dark:bg-input/30";

const DAILY_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180];
const WEEKLY_OPTIONS = [0, 60, 120, 180, 240, 300, 420, 600, 900];

function useSavePreference() {
  const update = useUpdatePreferences();
  const save = (patch: Partial<StudyPreferences>, message = "Preferência salva.") =>
    update.mutate(patch, {
      onSuccess: () => toast.success(message),
      onError: () => toast.error("Não foi possível salvar. Tente de novo."),
    });
  return { save, pending: update.isPending };
}

function PreferencesState({
  children,
}: {
  children: (preferences: StudyPreferences) => React.ReactNode;
}) {
  const { data, isPending, isError, refetch } = usePreferences();
  if (isPending) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          Não foi possível carregar as preferências.
          <Button variant="link" className="h-auto p-0" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </AlertTitle>
      </Alert>
    );
  }
  return <>{children(data)}</>;
}

const goalLabel = (minutes: number) => (minutes ? formatDuration(minutes * 60) : "Sem meta");

export function GoalsCard() {
  const { save, pending } = useSavePreference();
  const ids = { daily: useId(), weekly: useId() };

  return (
    <Card id="metas" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Metas de estudo</CardTitle>
        <CardDescription>
          O tempo conta enquanto a página da aula está aberta e visível. O progresso aparece no
          início.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PreferencesState>
          {(preferences) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={ids.daily}>Por dia</Label>
                <select
                  id={ids.daily}
                  value={preferences.daily_goal_minutes}
                  disabled={pending}
                  onChange={(event) =>
                    save({ daily_goal_minutes: Number(event.target.value) }, "Meta salva.")
                  }
                  className={SELECT_CLASS}
                >
                  {withCurrent(DAILY_OPTIONS, preferences.daily_goal_minutes ?? 0).map(
                    (minutes) => (
                      <option key={minutes} value={minutes}>
                        {goalLabel(minutes)}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={ids.weekly}>Por semana</Label>
                <select
                  id={ids.weekly}
                  value={preferences.weekly_goal_minutes}
                  disabled={pending}
                  onChange={(event) =>
                    save({ weekly_goal_minutes: Number(event.target.value) }, "Meta salva.")
                  }
                  className={SELECT_CLASS}
                >
                  {withCurrent(WEEKLY_OPTIONS, preferences.weekly_goal_minutes ?? 0).map(
                    (minutes) => (
                      <option key={minutes} value={minutes}>
                        {goalLabel(minutes)}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
          )}
        </PreferencesState>
      </CardContent>
    </Card>
  );
}

/** Options plus the saved value, if it isn't one of them (restored from a backup). */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

const CHANNELS = [
  { value: "telegram", label: "Telegram", env: "TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID" },
  { value: "email", label: "E-mail", env: "EMAIL_HOST (e usuário/senha) e REMINDER_EMAIL_TO" },
] as const;

export function ReminderCard() {
  const { save, pending } = useSavePreference();
  const ids = { enabled: useId(), time: useId() };
  const test = useMutation({
    mutationFn: () => unwrap(api.POST("/api/reminders/test")),
    onSuccess: (result) => {
      if (result.sent.length) toast.success("Mensagem de teste enviada.");
      if (Object.keys(result.errors).length) {
        toast.error(`Falhou: ${Object.keys(result.errors).join(", ")}. Confira a configuração.`);
      }
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : "Não foi possível enviar."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" aria-hidden /> Lembrete diário
        </CardTitle>
        <CardDescription>
          Se até o horário escolhido você ainda não tiver estudado, chega uma mensagem com a sua
          sequência, a meta do dia e a aula para continuar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PreferencesState>
          {(preferences) => (
            <div className="grid gap-5">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor={ids.enabled} className="leading-snug font-normal">
                  Enviar lembrete
                </Label>
                <Switch
                  id={ids.enabled}
                  checked={preferences.reminder_enabled}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    save(
                      { reminder_enabled: checked },
                      checked ? "Lembrete ligado." : "Lembrete desligado.",
                    )
                  }
                />
              </div>
              <ReminderTime
                inputId={ids.time}
                value={(preferences.reminder_time ?? "20:00").slice(0, 5)}
                disabled={!preferences.reminder_enabled || pending}
                onSave={(time) => save({ reminder_time: time }, "Horário salvo.")}
              />
              <div className="grid gap-2">
                <p className="text-sm font-medium">Canais</p>
                <ul className="grid gap-1.5 text-sm">
                  {CHANNELS.map((channel) => {
                    const on = preferences.reminder_channels.includes(channel.value);
                    return (
                      <li key={channel.value} className="flex items-start gap-2">
                        {on ? (
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden
                          />
                        ) : (
                          <Circle
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                            aria-hidden
                          />
                        )}
                        <span>
                          {channel.label}:{" "}
                          {on ? (
                            "configurado"
                          ) : (
                            <span className="text-muted-foreground">
                              não configurado (defina {channel.env} no .env do servidor)
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit max-sm:h-10"
                  disabled={!preferences.reminder_channels.length || test.isPending}
                  onClick={() => test.mutate()}
                >
                  {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Enviar teste
                </Button>
              </div>
            </div>
          )}
        </PreferencesState>
      </CardContent>
    </Card>
  );
}

function ReminderTime({
  inputId,
  value,
  disabled,
  onSave,
}: {
  inputId: string;
  value: string;
  disabled: boolean;
  onSave: (time: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Label htmlFor={inputId} className="font-normal text-muted-foreground">
        Horário
      </Label>
      <Input
        id={inputId}
        type="time"
        value={draft}
        step={900}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft && draft !== value && onSave(draft)}
        className="h-10 w-32 sm:h-8"
      />
      <span className="text-sm text-muted-foreground">(horário de Brasília)</span>
    </div>
  );
}

export function AutoSyncCard() {
  const { save, pending } = useSavePreference();
  const switchId = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="size-4" aria-hidden /> Sincronização automática
        </CardTitle>
        <CardDescription>
          Uma vez por dia, cada curso não arquivado é comparado com o Drive. O que o dono da pasta
          adicionou aparece com a etiqueta “Nova” e um aviso no início.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PreferencesState>
          {(preferences) => (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={switchId} className="leading-snug font-normal">
                Sincronizar todos os dias
              </Label>
              <Switch
                id={switchId}
                checked={preferences.auto_sync}
                disabled={pending}
                onCheckedChange={(checked) =>
                  save(
                    { auto_sync: checked },
                    checked
                      ? "Sincronização automática ligada."
                      : "Sincronização automática desligada.",
                  )
                }
              />
            </div>
          )}
        </PreferencesState>
      </CardContent>
    </Card>
  );
}

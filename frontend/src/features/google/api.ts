import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type GoogleStatus = components["schemas"]["GoogleStatus"];

export const googleKeys = {
  status: ["google", "status"] as const,
};

export function useGoogleStatus() {
  return useQuery({
    queryKey: googleKeys.status,
    queryFn: () => unwrap(api.GET("/api/google/status")),
  });
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/google/disconnect")),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: googleKeys.status }),
  });
}

/** Full-page navigation (not fetch): the backend redirects to Google's consent screen. */
export function googleConnectUrl(next: string): string {
  return `/api/google/connect?next=${encodeURIComponent(next)}`;
}

/** Error codes returned by the API (409) or in the OAuth callback redirect (?reason=). */
export const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "O servidor não tem GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET configurados. Veja docs/google-oauth.md.",
  access_denied: "A autorização foi cancelada no Google.",
  invalid_state: "A autorização expirou ou é inválida. Tente conectar de novo.",
  google_scope_denied:
    "A permissão de leitura do Drive não foi concedida. Conecte de novo e deixe a caixa do Drive marcada.",
  google_no_refresh_token: "O Google não enviou o acesso offline. Tente conectar de novo.",
  exchange_failed: "Não foi possível concluir a autorização com o Google. Tente de novo.",
  drive_api_disabled:
    "A Google Drive API não está ativada no seu projeto do Google Cloud (docs/google-oauth.md, passo 2).",
  google_not_connected: "Conecte sua conta Google antes de continuar.",
  google_reconnect_required: "A conexão com o Google expirou. Reconecte sua conta.",
};

export const GOOGLE_RECONNECT_CODES = new Set([
  "google_not_connected",
  "google_reconnect_required",
]);

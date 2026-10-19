"use client";

import { AlertTriangle, CheckCircle2, Loader2, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { GoogleIcon } from "./google-icon";
import { googleConnectUrl, useDisconnectGoogle, useGoogleStatus } from "./api";

type Props = {
  /** Frontend path Google sends you back to after consent. */
  returnTo: string;
};

export function GoogleAccountCard({ returnTo }: Props) {
  const { data: status, isPending, isError, refetch } = useGoogleStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GoogleIcon className="size-5" /> Conta Google
        </CardTitle>
        <CardDescription>
          Acesso somente leitura ao Google Drive, usado para listar as pastas e os vídeos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Não foi possível verificar a conexão.</AlertTitle>
            <AlertDescription>
              <Button variant="link" className="h-auto p-0" onClick={() => void refetch()}>
                Tentar de novo
              </Button>
            </AlertDescription>
          </Alert>
        ) : !status.configured ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>Integração não configurada no servidor</AlertTitle>
            <AlertDescription>
              Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env e reinicie o backend. O passo a
              passo está em docs/google-oauth.md.
            </AlertDescription>
          </Alert>
        ) : status.connected && status.needs_reconnect ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>A conexão com o Google expirou</AlertTitle>
            <AlertDescription>
              Reconecte {status.email ? <strong>{status.email}</strong> : "sua conta"} para voltar a
              importar e sincronizar. Seu progresso não é afetado.
            </AlertDescription>
          </Alert>
        ) : status.connected ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Conectado como <strong className="font-medium">{status.email}</strong>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma conta conectada. Use a conta Google que tem acesso às aulas.
          </p>
        )}
      </CardContent>
      {status?.configured && (
        <CardFooter className="flex flex-wrap gap-2">
          {status.connected ? (
            <>
              <Button asChild variant={status.needs_reconnect ? "default" : "outline"}>
                <a href={googleConnectUrl(returnTo)}>
                  <RefreshCw className="size-4" /> Reconectar
                </a>
              </Button>
              <DisconnectButton email={status.email ?? ""} />
            </>
          ) : (
            <Button asChild>
              <a href={googleConnectUrl(returnTo)}>
                <GoogleIcon className="size-4" /> Conectar Google
              </a>
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

function DisconnectButton({ email }: { email: string }) {
  const disconnect = useDisconnectGoogle();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-muted-foreground">
          <LogOut className="size-4" /> Desconectar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desconectar a conta Google?</DialogTitle>
          <DialogDescription>
            O acesso de {email || "sua conta"} será revogado. Cursos, progresso e anotações
            continuam salvos, mas não será possível importar ou sincronizar até conectar de novo.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={disconnect.isPending}
            onClick={() =>
              disconnect.mutate(undefined, {
                onSuccess: () => toast.success("Conta Google desconectada."),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            {disconnect.isPending && <Loader2 className="size-4 animate-spin" />}
            Desconectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { AlertTriangle, ExternalLink, HelpCircle, RotateCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { useGoogleStatus } from "@/features/google/api";

type Props = {
  driveUrl: string;
  /** The iframe hasn't loaded after a while: show the hint as an alert instead of a link. */
  prominent: boolean;
  onReload: () => void;
};

/** `authuser` makes Google pick that account in a new tab (it can show the account chooser). */
export function withAuthUser(url: string, email: string | null | undefined): string {
  return email ? `${url}?authuser=${encodeURIComponent(email)}` : url;
}

export function VideoHelp({ driveUrl, prominent, onReload }: Props) {
  const { data: google } = useGoogleStatus();
  const email = google?.email;
  const openUrl = withAuthUser(driveUrl, email);

  const trigger = (
    <DialogTrigger asChild>
      <Button
        variant="link"
        size="sm"
        className="h-auto gap-1 p-0 text-xs text-muted-foreground hover:text-foreground"
      >
        <HelpCircle className="size-3.5" aria-hidden /> O vídeo não carrega?
      </Button>
    </DialogTrigger>
  );

  return (
    <Dialog>
      {prominent ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>O vídeo está demorando para carregar</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {trigger}
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline-offset-4 hover:underline"
            >
              Abrir no Drive
            </a>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {trigger}
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ExternalLink className="size-3.5" aria-hidden /> Abrir no Drive
            <span className="sr-only">(nova aba)</span>
          </a>
        </div>
      )}

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>O vídeo não carrega?</DialogTitle>
          <DialogDescription>
            O player é o do próprio Google Drive. Ele usa a sessão do Google deste navegador, não a
            conexão feita nas Configurações.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid gap-4 text-sm">
          <HelpItem title="Conta Google errada">
            Este navegador precisa estar logado na conta que tem acesso à pasta
            {email ? (
              <>
                {" "}
                (<strong className="font-medium">{email}</strong>)
              </>
            ) : null}
            . Entre nela em google.com e recarregue o player.
          </HelpItem>
          <HelpItem title="Várias contas abertas">
            O player embutido sempre usa a conta padrão do navegador (a primeira em que você
            entrou). Use o botão <em>Abrir no Drive</em> abaixo, que já escolhe a conta certa, ou um
            perfil do navegador só com essa conta.
          </HelpItem>
          <HelpItem title="Safari ou bloqueio de cookies de terceiros">
            Dentro de outro site, o Google precisa de cookies de terceiros. No Safari, desative
            Ajustes → Privacidade → <em>Impedir rastreamento entre sites</em>. No Chrome, adicione
            este endereço em Configurações → Privacidade e segurança → Cookies de terceiros →{" "}
            <em>Permitidos a usar cookies de terceiros</em>. No Firefox, desative a proteção contra
            rastreamento para este site (ícone de escudo na barra de endereço).
          </HelpItem>
          <HelpItem title="Vídeo recém-enviado">
            Se o dono acabou de enviar o arquivo, o Drive pode mostrar &quot;ainda processando&quot;
            por alguns minutos.
          </HelpItem>
        </ol>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={onReload}>
              <RotateCw /> Recarregar player
            </Button>
          </DialogClose>
          <Button asChild>
            <a href={openUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Abrir no Drive
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HelpItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="grid gap-1">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </li>
  );
}

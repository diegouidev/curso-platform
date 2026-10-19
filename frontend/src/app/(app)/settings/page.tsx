import type { Metadata } from "next";
import { Suspense } from "react";

import { GoogleAccountCard } from "@/features/google/google-account-card";
import { OAuthResultToast } from "@/features/google/oauth-result-toast";
import { CompletionSettingsCard } from "@/features/lessons/completion-settings-card";
import { AppearanceCard } from "@/features/settings/appearance-card";
import { BackupCard } from "@/features/settings/backup-card";

export const metadata: Metadata = { title: "Configurações" };

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-8">
      <Suspense>
        <OAuthResultToast />
      </Suspense>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
      </header>
      <section aria-labelledby="google" className="grid gap-3">
        <h2 id="google" className="text-sm font-medium text-muted-foreground">
          Integrações
        </h2>
        <GoogleAccountCard returnTo="/settings" />
      </section>
      <section aria-labelledby="estudo" className="grid gap-3">
        <h2 id="estudo" className="text-sm font-medium text-muted-foreground">
          Estudo
        </h2>
        <CompletionSettingsCard />
        <AppearanceCard />
      </section>
      <section aria-labelledby="dados" className="grid gap-3">
        <h2 id="dados" className="text-sm font-medium text-muted-foreground">
          Dados
        </h2>
        <BackupCard />
      </section>
    </div>
  );
}

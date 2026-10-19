import type { Metadata } from "next";
import { Suspense } from "react";

import { GoogleAccountCard } from "@/features/google/google-account-card";
import { OAuthResultToast } from "@/features/google/oauth-result-toast";

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
    </div>
  );
}

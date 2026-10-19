"use client";

import { FolderOpen } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {user?.username}</h1>
        <p className="text-muted-foreground">Seu painel de estudos.</p>
      </header>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted">
            <FolderOpen className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <h2 className="text-lg font-medium">Nenhum curso ainda</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Em breve você poderá conectar sua conta Google e importar a pasta de um curso do Drive.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

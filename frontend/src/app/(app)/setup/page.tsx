"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback } from "react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportCourseForm } from "@/features/courses/import-course-form";
import { useGoogleStatus } from "@/features/google/api";
import { GoogleAccountCard } from "@/features/google/google-account-card";
import { OAuthResultToast } from "@/features/google/oauth-result-toast";
import { cn } from "@/lib/utils";

export default function SetupPage() {
  const router = useRouter();
  const { data: google } = useGoogleStatus();
  const connected = !!google?.connected && !google.needs_reconnect;

  const onImported = useCallback(
    (courseId: number) => {
      toast.success("Curso importado. Bons estudos!");
      router.push(`/courses/${courseId}`);
    },
    [router],
  );

  return (
    <div className="mx-auto grid max-w-2xl gap-8">
      <Suspense>
        <OAuthResultToast />
      </Suspense>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Configuração inicial</h1>
        <p className="text-muted-foreground">Dois passos e suas aulas estarão organizadas aqui.</p>
      </header>

      <ol className="grid gap-6">
        <Step number={1} done={connected} title="Conectar sua conta Google">
          <GoogleAccountCard returnTo="/setup" />
        </Step>
        <Step number={2} title="Importar o primeiro curso">
          <Card className={cn(!connected && "opacity-60")}>
            <CardHeader>
              <CardTitle>Pasta do curso</CardTitle>
              <CardDescription>
                {connected
                  ? "Use o link da pasta principal, a que contém os módulos."
                  : "Disponível depois de conectar a conta Google."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImportCourseForm onImported={onImported} disabled={!connected} />
            </CardContent>
          </Card>
        </Step>
      </ol>
    </div>
  );
}

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="grid gap-3">
      <h2 className="flex items-center gap-3 font-medium">
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full border text-sm tabular-nums",
            done && "border-transparent bg-primary text-primary-foreground",
          )}
          aria-hidden
        >
          {done ? <Check className="size-4" /> : number}
        </span>
        {title}
        {done && <span className="sr-only">(concluído)</span>}
      </h2>
      {children}
    </li>
  );
}

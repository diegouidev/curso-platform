"use client";

import { AlertTriangle, FolderOpen } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseCard } from "@/features/courses/course-card";
import { useCourses } from "@/features/courses/api";
import { ImportCourseDialog } from "@/features/courses/import-course-dialog";
import { useGoogleStatus } from "@/features/google/api";
import { ContinueCard } from "@/features/lessons/continue-card";

export default function DashboardPage() {
  const { user } = useAuth();
  const courses = useCourses();
  const google = useGoogleStatus();
  const active = courses.data?.filter((course) => !course.is_archived) ?? [];
  const archived = courses.data?.filter((course) => course.is_archived) ?? [];
  const canImport = google.data?.connected && !google.data.needs_reconnect;

  return (
    <div className="grid grid-cols-1 gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {user?.username}</h1>
          <p className="text-muted-foreground">Seus cursos e o quanto já avançou em cada um.</p>
        </div>
        {canImport && !!courses.data?.length && <ImportCourseDialog />}
      </header>

      {courses.isPending ? (
        <CourseGridSkeleton />
      ) : courses.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-6 text-destructive" aria-hidden />
            <p>Não foi possível carregar seus cursos.</p>
            <Button variant="outline" onClick={() => void courses.refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : courses.data.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted">
              <FolderOpen className="size-6 text-muted-foreground" aria-hidden />
            </span>
            <h2 className="text-lg font-medium">Nenhum curso ainda</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {canImport
                ? "Importe a pasta de um curso do Google Drive para começar."
                : "Conecte sua conta Google e importe a pasta de um curso para começar."}
            </p>
            {canImport ? (
              <ImportCourseDialog />
            ) : (
              <Button asChild>
                <Link href="/setup">Configurar agora</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <ContinueCard />
          <section aria-labelledby="cursos" className="grid gap-4">
            <h2 id="cursos" className="sr-only">
              Cursos
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>
          </section>
          {archived.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Arquivados ({archived.length})
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function CourseGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border">
          <Skeleton className="aspect-video rounded-none" />
          <div className="grid gap-3 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

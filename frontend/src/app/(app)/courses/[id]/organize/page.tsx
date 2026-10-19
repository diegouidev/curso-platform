"use client";

import { AlertTriangle, ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useCourse } from "@/features/courses/api";
import { useResetOrder } from "@/features/organize/api";
import { CourseOrganizer } from "@/features/organize/course-organizer";
import { ApiError } from "@/lib/api/client";

export default function OrganizePage() {
  const id = Number(useParams<{ id: string }>().id);
  const { data: course, isPending, error, refetch } = useCourse(id);

  useEffect(() => {
    if (course) document.title = `Organizar ${course.title} · Estudos`;
  }, [course]);

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-xl" />
        ))}
      </div>
    );
  }
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="size-6 text-muted-foreground" aria-hidden />
          <p>{notFound ? "Curso não encontrado." : "Não foi possível carregar o curso."}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6">
      <Link
        href={`/courses/${course.id}`}
        className="flex w-fit max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 shrink-0" />
        <span className="truncate">{course.title}</span>
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Organizar curso</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Arraste pelo ícone ⋮⋮ para reordenar, use o lápis para renomear e o olho para ocultar o
            que não interessa. Nada disso altera o Google Drive, e a sincronização mantém suas
            mudanças.
          </p>
        </div>
        <ResetOrderButton courseId={course.id} />
      </header>
      {course.modules.length ? (
        <CourseOrganizer course={course} />
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Este curso ainda não tem módulos. Sincronize com o Drive primeiro.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResetOrderButton({ courseId }: { courseId: number }) {
  const reset = useResetOrder(courseId);
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RotateCcw /> Restaurar ordem do Drive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restaurar a ordem do Drive?</DialogTitle>
          <DialogDescription>
            Módulos e aulas voltam para a ordem dos nomes no Drive. Títulos editados e itens ocultos
            não mudam.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button
            disabled={reset.isPending}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success("Ordem do Drive restaurada.");
                },
                onError: () => toast.error("Não foi possível restaurar a ordem."),
              })
            }
          >
            {reset.isPending && <Loader2 className="animate-spin" />} Restaurar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

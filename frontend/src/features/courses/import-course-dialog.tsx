"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { ImportCourseForm } from "./import-course-form";

export function ImportCourseDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const onImported = useCallback(
    (courseId: number) => {
      toast.success("Curso importado.");
      setOpen(false);
      router.push(`/courses/${courseId}`);
    },
    [router],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Importar curso
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar curso do Google Drive</DialogTitle>
          <DialogDescription>
            Cole o link da pasta principal do curso. Nada é alterado no Drive.
          </DialogDescription>
        </DialogHeader>
        {/* Remount on open so a finished import doesn't linger. */}
        {open && <ImportCourseForm onImported={onImported} autoFocus />}
      </DialogContent>
    </Dialog>
  );
}

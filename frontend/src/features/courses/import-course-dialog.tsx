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

type Props = {
  /** Controlled mode: the parent opens it from its own buttons (see the dashboard). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ImportCourseDialog({ open: controlledOpen, onOpenChange }: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const router = useRouter();

  const onImported = useCallback(
    (courseId: number) => {
      toast.success("Curso importado.");
      setOpen(false);
      router.push(`/courses/${courseId}`);
    },
    [router, setOpen],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" /> Importar curso
          </Button>
        </DialogTrigger>
      )}
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

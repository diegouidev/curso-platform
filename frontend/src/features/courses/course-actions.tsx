"use client";

import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ImageUp,
  ListOrdered,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCourseThumbnail } from "@/features/organize/api";
import { ApiError } from "@/lib/api/client";

import { useUpdateCourse, type CourseDetail } from "./api";

const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** "More actions" menu of the course page: edit, organize, archive. */
export function CourseActions({ course }: { course: CourseDetail }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCourse(course.id);

  const setArchived = (archived: boolean) =>
    update.mutate(
      { is_archived: archived },
      {
        onSuccess: () =>
          toast.success(archived ? "Curso arquivado." : "Curso de volta à lista.", {
            action: archived
              ? { label: "Desfazer", onClick: () => update.mutate({ is_archived: false }) }
              : undefined,
          }),
        onError: () => toast.error("Não foi possível salvar."),
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Mais ações do curso">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Editar título, capa e descrição
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/courses/${course.id}/organize`}>
              <ListOrdered /> Organizar módulos e aulas
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setArchived(!course.is_archived)}>
            {course.is_archived ? <ArchiveRestore /> : <Archive />}
            {course.is_archived ? "Desarquivar" : "Arquivar curso"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar curso</DialogTitle>
            <DialogDescription>Só muda aqui na plataforma; o Drive fica igual.</DialogDescription>
          </DialogHeader>
          {editing && <EditCourseForm course={course} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditCourseForm({ course, onDone }: { course: CourseDetail; onDone: () => void }) {
  const update = useUpdateCourse(course.id);
  const [title, setTitle] = useState(course.title_is_custom ? course.title : "");
  const [description, setDescription] = useState(course.description);
  const ids = { title: useId(), description: useId(), cover: useId() };

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          { title, description },
          {
            onSuccess: () => {
              toast.success("Curso atualizado.");
              onDone();
            },
            onError: () => toast.error("Não foi possível salvar."),
          },
        );
      }}
    >
      <CoverField course={course} inputId={ids.cover} />
      <div className="grid gap-2">
        <Label htmlFor={ids.title}>Título</Label>
        <Input
          id={ids.title}
          value={title}
          maxLength={255}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={course.drive_name_original || course.title}
          aria-describedby={`${ids.title}-hint`}
        />
        <p id={`${ids.title}-hint`} className="text-xs text-muted-foreground">
          Deixe vazio para usar o nome da pasta no Drive.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ids.description}>Descrição</Label>
        <textarea
          id={ids.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Do que se trata, por que você está fazendo…"
          className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />} Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function CoverField({ course, inputId }: { course: CourseDetail; inputId: string }) {
  const { upload, remove } = useCourseThumbnail(course.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || remove.isPending;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) {
      toast.error("A imagem precisa ter no máximo 5 MB.");
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast.success("Capa atualizada."),
      onError: (error) =>
        toast.error(error instanceof ApiError ? error.message : "Não foi possível enviar a capa."),
    });
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>Capa</Label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative grid aspect-video w-40 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
          {course.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- local uploads, no optimizer needed
            <img
              src={course.thumbnail_url}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <BookOpen className="size-6 text-muted-foreground/60" aria-hidden />
          )}
          {busy && (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2 className="size-5 animate-spin" aria-hidden />
            </span>
          )}
        </div>
        <div className="grid gap-2">
          <input
            ref={fileInput}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => {
              onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <ImageUp /> {course.thumbnail_url ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {course.thumbnail_url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                remove.mutate(undefined, {
                  onError: () => toast.error("Não foi possível remover a capa."),
                })
              }
            >
              <Trash2 /> Remover
            </Button>
          )}
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP ou GIF, até 5 MB.</p>
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, CloudOff, Eye, EyeOff, GripVertical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CourseDetail, LessonSummary, Module } from "@/features/courses/api";
import { formatClock, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useReorder, useUpdateLesson, useUpdateModule } from "./api";
import { EditableTitle } from "./editable-title";

const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Para mover, pressione espaço ou Enter. Use as setas para cima e para baixo para mudar de " +
    "posição e espaço ou Enter de novo para soltar. Esc cancela.",
};

function announcements(label: (id: UniqueIdentifier) => string): Announcements {
  return {
    onDragStart: ({ active }) => `${label(active.id)} selecionado.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${label(active.id)} na posição de ${label(over.id)}.`
        : `${label(active.id)} fora da lista.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${label(active.id)} solto na posição de ${label(over.id)}.`
        : `${label(active.id)} solto.`,
    onDragCancel: ({ active }) => `Movimento de ${label(active.id)} cancelado.`,
  };
}

function useListSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Reorders `items` after a drop and returns the new id order, or null if nothing moved. */
function droppedOrder<T extends { id: number }>(items: T[], event: DragEndEvent): number[] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const from = items.findIndex((item) => item.id === active.id);
  const to = items.findIndex((item) => item.id === over.id);
  if (from < 0 || to < 0) return null;
  return arrayMove(items, from, to).map((item) => item.id);
}

export function CourseOrganizer({ course }: { course: CourseDetail }) {
  const sensors = useListSensors();
  const reorder = useReorder(course.id);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const titles = new Map(course.modules.map((m) => [m.id, m.title]));

  const onDragEnd = (event: DragEndEvent) => {
    const ids = droppedOrder(course.modules, event);
    if (!ids) return;
    reorder.mutate(
      { kind: "modules", parentId: course.id, ids },
      { onError: () => toast.error("Não foi possível salvar a nova ordem.") },
    );
  };

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: announcements((id) => `“${titles.get(Number(id)) ?? ""}”`),
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
    >
      <SortableContext
        items={course.modules.map((m) => m.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="grid grid-cols-1 gap-2" aria-label="Módulos">
          {course.modules.map((module) => (
            <ModuleRow
              key={module.id}
              courseId={course.id}
              module={module}
              expanded={expanded.has(module.id)}
              onToggle={() => toggle(module.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function useSortableRow(id: number) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  return { ...sortable, style };
}

function DragHandle({
  label,
  sortable,
}: {
  label: string;
  sortable: ReturnType<typeof useSortableRow>;
}) {
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      aria-label={label}
      className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing max-sm:size-10"
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}

function HideToggle({
  hidden,
  name,
  onToggle,
  disabled,
}: {
  hidden: boolean;
  name: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground max-sm:size-10"
      aria-label={hidden ? `Mostrar ${name}` : `Ocultar ${name}`}
      title={hidden ? "Mostrar" : "Ocultar"}
      onClick={onToggle}
      disabled={disabled}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </Button>
  );
}

function ModuleRow({
  courseId,
  module,
  expanded,
  onToggle,
}: {
  courseId: number;
  module: Module;
  expanded: boolean;
  onToggle: () => void;
}) {
  const sortable = useSortableRow(module.id);
  const update = useUpdateModule(courseId);
  const save = (body: Parameters<typeof update.mutateAsync>[0]["body"]) =>
    update.mutateAsync({ id: module.id, body }).catch((error: unknown) => {
      toast.error("Não foi possível salvar o módulo.");
      throw error;
    });
  const panelId = `module-${module.id}-lessons`;

  return (
    <li
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={cn(
        "rounded-xl border bg-card",
        sortable.isDragging && "relative z-10 shadow-lg ring-2 ring-ring/40",
      )}
    >
      <div className={cn("flex items-center gap-1 p-2", module.is_hidden && "opacity-60")}>
        <DragHandle label={`Arrastar módulo ${module.title}`} sortable={sortable} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 max-sm:size-10"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? "Recolher" : "Mostrar"} aulas de ${module.title}`}
          onClick={onToggle}
        >
          <ChevronRight className={cn("transition-transform", expanded && "rotate-90")} />
        </Button>
        <EditableTitle
          title={module.title}
          isCustom={module.title_is_custom}
          noun="módulo"
          onSave={(title) => save({ title })}
          className="font-medium"
        />
        <span className="hidden shrink-0 px-1 text-xs text-muted-foreground sm:inline">
          {plural(module.lessons.length, "aula", "aulas")}
        </span>
        {module.missing_in_drive && <MissingBadge />}
        {module.is_hidden && (
          <Badge variant="outline" className="shrink-0 font-normal">
            Oculto
          </Badge>
        )}
        <HideToggle
          hidden={module.is_hidden}
          name={`módulo ${module.title}`}
          onToggle={() => void save({ is_hidden: !module.is_hidden }).catch(() => undefined)}
          disabled={update.isPending}
        />
      </div>
      {expanded && (
        <div id={panelId} className="border-t px-2 py-2">
          {module.lessons.length ? (
            <LessonList courseId={courseId} module={module} />
          ) : (
            <p className="px-2 py-1 text-sm text-muted-foreground">Nenhuma aula neste módulo.</p>
          )}
        </div>
      )}
    </li>
  );
}

function LessonList({ courseId, module }: { courseId: number; module: Module }) {
  const sensors = useListSensors();
  const reorder = useReorder(courseId);
  const titles = new Map(module.lessons.map((l) => [l.id, l.title]));

  const onDragEnd = (event: DragEndEvent) => {
    const ids = droppedOrder(module.lessons, event);
    if (!ids) return;
    reorder.mutate(
      { kind: "lessons", parentId: module.id, ids },
      { onError: () => toast.error("Não foi possível salvar a nova ordem.") },
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: announcements((id) => `“${titles.get(Number(id)) ?? ""}”`),
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
    >
      <SortableContext
        items={module.lessons.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="grid grid-cols-1" aria-label={`Aulas de ${module.title}`}>
          {module.lessons.map((lesson) => (
            <LessonRow key={lesson.id} courseId={courseId} lesson={lesson} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function LessonRow({ courseId, lesson }: { courseId: number; lesson: LessonSummary }) {
  const sortable = useSortableRow(lesson.id);
  const update = useUpdateLesson(courseId);
  const save = (body: Parameters<typeof update.mutateAsync>[0]["body"]) =>
    update.mutateAsync({ id: lesson.id, body }).catch((error: unknown) => {
      toast.error("Não foi possível salvar a aula.");
      throw error;
    });

  return (
    <li
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-lg px-1 py-0.5 text-sm hover:bg-muted/50",
        sortable.isDragging && "relative z-10 bg-card shadow-md ring-2 ring-ring/40",
      )}
    >
      <DragHandle label={`Arrastar aula ${lesson.title}`} sortable={sortable} />
      <div
        className={cn("flex min-w-0 flex-1 items-center gap-1", lesson.is_hidden && "opacity-60")}
      >
        <EditableTitle
          title={lesson.title}
          isCustom={lesson.title_is_custom}
          noun="aula"
          onSave={(title) => save({ title })}
        />
        {lesson.missing_in_drive && <MissingBadge />}
        {lesson.is_hidden && (
          <Badge variant="outline" className="shrink-0 font-normal">
            Oculta
          </Badge>
        )}
        {lesson.duration_seconds != null && (
          <span className="hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">
            {formatClock(lesson.duration_seconds)}
          </span>
        )}
      </div>
      <HideToggle
        hidden={lesson.is_hidden}
        name={`aula ${lesson.title}`}
        onToggle={() => void save({ is_hidden: !lesson.is_hidden }).catch(() => undefined)}
        disabled={update.isPending}
      />
    </li>
  );
}

function MissingBadge() {
  return (
    <Badge variant="outline" className="shrink-0 gap-1 font-normal text-muted-foreground">
      <CloudOff className="size-3" aria-hidden /> Fora do Drive
    </Badge>
  );
}

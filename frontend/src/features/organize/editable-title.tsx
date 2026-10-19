"use client";

import { Check, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  isCustom: boolean;
  /** Called with the new title; "" restores the Drive-derived title. */
  onSave: (title: string) => Promise<unknown>;
  /** What is being renamed, for screen readers ("módulo", "aula"). */
  noun: string;
  className?: string;
};

/** Title with a pencil to rename in place: Enter saves, Esc cancels, empty restores. */
export function EditableTitle({ title, isCustom, onSave, noun, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);

  const save = async (next: string) => {
    if (next.trim() === title && next !== "") {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // The caller already told the user; stay in edit mode to retry.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <form
        className={cn("flex min-w-0 flex-1 items-center gap-1", className)}
        onSubmit={(event) => {
          event.preventDefault();
          void save(value);
        }}
      >
        <Input
          autoFocus
          value={value}
          maxLength={255}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          aria-label={`Novo título d${noun === "aula" ? "a" : "o"} ${noun}`}
          placeholder="Vazio = nome do Drive"
          className="h-8 min-w-0 flex-1"
          disabled={saving}
        />
        <Button type="submit" size="icon-sm" aria-label="Salvar título" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancelar"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          <X />
        </Button>
      </form>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1", className)}>
      <span className="min-w-0 truncate" title={title}>
        {title}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground"
        aria-label={`Renomear ${noun}: ${title}`}
        onClick={() => {
          setValue(title);
          setEditing(true);
        }}
      >
        <Pencil />
      </Button>
      {isCustom && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label={`Restaurar o nome do Drive: ${title}`}
          title="Restaurar o nome do Drive"
          disabled={saving}
          onClick={() => void save("")}
        >
          {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
        </Button>
      )}
    </div>
  );
}

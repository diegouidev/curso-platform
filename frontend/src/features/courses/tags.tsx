"use client";

import { Tag as TagIcon, X } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_TAGS = 12;
const MAX_LENGTH = 40;

export function TagList({ tags, className }: { tags: string[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Tags">
      {tags.map((tag) => (
        <li
          key={tag}
          className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          <TagIcon className="size-3" aria-hidden />
          {tag}
        </li>
      ))}
    </ul>
  );
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Chips plus a text field: Enter or comma adds, Backspace on empty removes the last one. */
export function TagInput({
  value,
  onChange,
  suggestions,
  inputId,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Tags already used by other courses, offered as completions. */
  suggestions: string[];
  inputId: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (...raws: string[]) => {
    const next = [...value];
    for (const raw of raws) {
      const name = raw.split(/\s+/).join(" ").trim().slice(0, MAX_LENGTH);
      if (!name || next.length >= MAX_TAGS) continue;
      if (next.some((tag) => fold(tag) === fold(name))) continue;
      // Reuse the spelling of an existing tag ("ingles" -> "Inglês").
      next.push(suggestions.find((tag) => fold(tag) === fold(name)) ?? name);
    }
    if (next.length !== value.length) onChange(next);
  };

  const remaining = suggestions.filter((tag) => !value.some((v) => fold(v) === fold(tag)));

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags do curso">
          {value.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-0.5 pl-2.5 text-sm"
            >
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== tag))}
                aria-label={`Remover tag ${tag}`}
                className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:size-7"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={inputId}
        value={draft}
        list={listId}
        maxLength={MAX_LENGTH}
        disabled={value.length >= MAX_TAGS}
        placeholder={value.length >= MAX_TAGS ? "Limite de tags atingido" : "Ex.: Programação"}
        onChange={(event) => {
          const text = event.target.value;
          if (text.includes(",")) {
            const parts = text.split(",");
            add(...parts.slice(0, -1));
            setDraft(parts.at(-1) ?? "");
          } else {
            setDraft(text);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
            setDraft("");
          } else if (event.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
            setDraft("");
          }
        }}
        className="h-10 sm:h-9"
      />
      <datalist id={listId}>
        {remaining.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}

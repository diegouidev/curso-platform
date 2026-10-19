import { useEffect, useRef } from "react";

export type ShortcutMap = Partial<Record<string, () => void>>;

/** The player's single-key shortcuts, shown in the UI next to each action. */
export const LESSON_SHORTCUTS = {
  complete: "m",
  next: "n",
  previous: "p",
  fullscreen: "f",
  focus: "s",
} as const;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    // Dialogs (attachment preview, help) and menus own the keyboard while open.
    target.closest("[role=dialog], [role=menu], [role=listbox]") !== null
  );
}

/**
 * Single-key shortcuts for the player page. Ignored while typing, with Ctrl/Alt/Meta (so
 * browser shortcuts and Ctrl+K keep working) and on key repeat. When focus is inside the
 * Drive iframe the browser sends keys to the Drive player instead; nothing can intercept them.
 */
export function useLessonShortcuts(shortcuts: ShortcutMap): void {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const action = latest.current[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

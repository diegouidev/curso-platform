import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * - "native": the Fullscreen API (desktop, Android, iPad).
 * - "expanded": iPhone Safari has no element fullscreen, so the player box is pinned over the
 *   whole viewport with CSS instead. Rotating the phone then gives a landscape player.
 *
 * Either way the iframe element is never re-created, so the video keeps playing.
 */
export type FullscreenMode = "off" | "native" | "expanded";

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

function orientation(): LockableOrientation | undefined {
  return typeof screen === "undefined" ? undefined : (screen.orientation as LockableOrientation);
}

async function lockLandscape(): Promise<void> {
  try {
    await orientation()?.lock?.("landscape");
  } catch {
    // Only some Android browsers allow it, and only in native fullscreen.
  }
}

function unlockOrientation(): void {
  try {
    orientation()?.unlock?.();
  } catch {
    // Not supported or not locked.
  }
}

export function usePlayerFullscreen(target: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>("off");

  // Native fullscreen can also end outside our control (Esc, Android back gesture).
  useEffect(() => {
    const onChange = () => {
      const element = document.fullscreenElement;
      const isOurs = element !== null && element === target.current;
      setMode((current) => (isOurs ? "native" : current === "native" ? "off" : current));
      if (!element) unlockOrientation();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [target]);

  // Expanded mode behaves like a modal: page scroll locked, Esc closes it.
  useEffect(() => {
    if (mode !== "expanded") return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode("off");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mode]);

  const enter = useCallback(async () => {
    const element = target.current;
    if (!element) return;
    if (document.fullscreenEnabled && typeof element.requestFullscreen === "function") {
      try {
        await element.requestFullscreen({ navigationUI: "hide" });
        await lockLandscape();
        return;
      } catch {
        // Refused (e.g. not counted as a user gesture): use the CSS fallback below.
      }
    }
    setMode("expanded");
  }, [target]);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setMode("off");
  }, []);

  const toggle = useCallback(() => {
    if (mode === "off") void enter();
    else exit();
  }, [mode, enter, exit]);

  return { mode, active: mode !== "off", toggle, exit };
}

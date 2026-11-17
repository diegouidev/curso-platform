import { useCallback, useEffect, useState } from "react";

/**
 * Shape of the player box on touch screens, where the Drive embed lays itself out
 * differently per engine:
 * - Chrome/Android (Blink): the video sits at the top with a row of control pills below it,
 *   so the box needs 16:9 plus room for them ("tall").
 * - Every browser on iPhone/iPad is WebKit (Chrome included): the Drive <video> fills the
 *   whole iframe with the picture centered and iOS's native controls on top. Extra height
 *   only adds black bands and scatters the controls, so the default there is plain 16:9.
 * The user can still pick another shape on the phone; it's remembered per device.
 */
export type PlayerShape = "wide" | "classic" | "tall";

export const PLAYER_SHAPES: { value: PlayerShape; label: string; description: string }[] = [
  { value: "wide", label: "16:9", description: "só o vídeo" },
  { value: "classic", label: "4:3", description: "um pouco mais alto" },
  { value: "tall", label: "Alto", description: "espaço para os controles do Drive" },
];

const STORAGE_KEY = "player:shape";

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isShape(value: string | null): value is PlayerShape {
  return PLAYER_SHAPES.some((shape) => shape.value === value);
}

export function usePlayerShape() {
  // Decided after mount: the server render can't know the device.
  const [state, setState] = useState<{ shape: PlayerShape | null; appleMobile: boolean }>({
    shape: null,
    appleMobile: false,
  });

  useEffect(() => {
    const appleMobile = isAppleMobile();
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked: use the default.
    }
    setState({ shape: isShape(saved) ? saved : appleMobile ? "wide" : null, appleMobile });
  }, []);

  const setShape = useCallback((shape: PlayerShape) => {
    setState((current) => ({ ...current, shape }));
    try {
      window.localStorage.setItem(STORAGE_KEY, shape);
    } catch {
      // ignore
    }
  }, []);

  return {
    /** null = the responsive default (tall on phones and touch tablets, 16:9 elsewhere). */
    shape: state.shape,
    appleMobile: state.appleMobile,
    setShape,
  };
}

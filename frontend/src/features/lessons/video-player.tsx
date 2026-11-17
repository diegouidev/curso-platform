"use client";

import { Loader2, Maximize, Maximize2, Minimize } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { usePlayerFullscreen } from "./use-player-fullscreen";
import { PLAYER_SHAPES, usePlayerShape, type PlayerShape } from "./use-player-shape";
import { VideoHelp } from "./video-help";

// After this long without the iframe's load event, the help hint gets more prominent.
const SLOW_LOAD_MS = 20_000;

export type VideoPlayerControls = { toggleFullscreen: () => void };

type Props = {
  embedUrl: string;
  driveUrl: string;
  title: string;
  iframeRef?: Ref<HTMLIFrameElement>;
  /** Lets the page drive the player (the F shortcut). */
  controlsRef?: Ref<VideoPlayerControls>;
};

/*
 * On Android phones (Blink) the Drive embed renders its mobile layout: a ~50px bar above the
 * 16:9 video and a row of control "pills" (play, time, settings, fullscreen) that reaches
 * ~30px below the video. That layout is sized by the width, not by the iframe height, so a
 * 16:9 box (or 16:9 + 3rem) cuts the controls off. Narrow screens and touch screens up to
 * tablet width get 16:9 + 6rem by default; the spare space at the bottom is just black.
 * iPhones (WebKit) lay it out differently: see use-player-shape.ts.
 */
const BOX = "relative overflow-hidden rounded-xl ring-1 ring-foreground/10";
const DEFAULT_SHAPE =
  "aspect-video max-sm:aspect-auto max-sm:pt-[calc(56.25%+6rem)] " +
  "max-lg:pointer-coarse:aspect-auto max-lg:pointer-coarse:pt-[calc(56.25%+6rem)]";
const SHAPE_CLASSES: Record<PlayerShape, string> = {
  wide: "aspect-video",
  classic: "aspect-[4/3]",
  tall: "aspect-auto pt-[calc(56.25%+6rem)]",
};
// Native fullscreen or the iPhone fallback: the same box pinned over the whole viewport.
const FULLSCREEN_BOX = "fixed inset-0 z-[100] h-dvh w-full";

/**
 * The official Drive embed (/preview). It plays because this browser is signed in to the
 * Google account that has access; the app never downloads or re-hosts the video.
 *
 * The iframe is cross-origin: "load" also fires when Google shows an error or sign-in page,
 * so the app can't tell whether the video works. The help link is always available.
 */
export function VideoPlayer({ embedUrl, driveUrl, title, iframeRef, controlsRef }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const enterButtonRef = useRef<HTMLButtonElement>(null);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const fullscreen = usePlayerFullscreen(boxRef);
  const { shape, appleMobile, setShape } = usePlayerShape();

  useImperativeHandle(controlsRef, () => ({ toggleFullscreen: fullscreen.toggle }), [
    fullscreen.toggle,
  ]);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [embedUrl, attempt]);

  // Focus follows the player in and out of fullscreen (keyboard and screen reader users).
  const wasActive = useRef(false);
  useEffect(() => {
    if (fullscreen.active) exitButtonRef.current?.focus();
    else if (wasActive.current) enterButtonRef.current?.focus();
    wasActive.current = fullscreen.active;
  }, [fullscreen.active]);

  return (
    <div className="grid grid-cols-1 gap-2">
      <div
        ref={boxRef}
        data-fullscreen={fullscreen.mode}
        data-shape={shape ?? "default"}
        className={cn(
          "bg-black",
          fullscreen.active ? FULLSCREEN_BOX : BOX,
          !fullscreen.active && (shape ? SHAPE_CLASSES[shape] : DEFAULT_SHAPE),
        )}
      >
        {!loaded && (
          <div
            className="absolute inset-0 grid place-items-center text-sm text-white/70"
            aria-hidden
          >
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Carregando vídeo…
            </span>
          </div>
        )}
        <iframe
          key={`${embedUrl}#${attempt}`}
          ref={iframeRef}
          src={embedUrl}
          title={`Vídeo: ${title}`}
          allow="autoplay; fullscreen"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 size-full border-0 transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
        {fullscreen.active && (
          <Button
            ref={exitButtonRef}
            type="button"
            size="sm"
            variant="secondary"
            onClick={fullscreen.exit}
            aria-label="Sair da tela cheia"
            className="absolute top-[max(0.5rem,env(safe-area-inset-top))] left-[max(0.5rem,env(safe-area-inset-left))] z-10 h-9 bg-black/70 px-3 text-white backdrop-blur hover:bg-black/90"
          >
            <Minimize className="size-4" aria-hidden /> Sair
          </Button>
        )}
      </div>
      <VideoHelp
        driveUrl={driveUrl}
        prominent={slow && !loaded}
        onReload={() => setAttempt((n) => n + 1)}
        actions={
          <Button
            ref={enterButtonRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={fullscreen.toggle}
            className="max-sm:h-9 max-sm:px-3"
          >
            <Maximize className="size-3.5" aria-hidden /> Tela cheia
            <Kbd className="ml-0.5 pointer-coarse:hidden" aria-hidden>
              F
            </Kbd>
          </Button>
        }
      />
      <ShapePicker
        // Phones and tablets only: on a mouse-driven screen the 16:9 desktop layout is right.
        className="pointer-fine:hidden"
        value={shape ?? (appleMobile ? "wide" : "tall")}
        onChange={setShape}
      />
      {appleMobile && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Maximize2 className="mt-px size-3.5 shrink-0" aria-hidden />
          No iPhone, o botão de tela cheia do próprio vídeo (no canto superior esquerdo, ao tocar no
          vídeo) abre o player do iOS, o mais estável. Se os controles ficarem embaralhados,
          experimente outro formato acima.
        </p>
      )}
    </div>
  );
}

/** Lets the phone owner pick the box shape that suits how the Drive embed renders there. */
function ShapePicker({
  value,
  onChange,
  className,
}: {
  value: PlayerShape;
  onChange: (shape: PlayerShape) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      <span id="formato-player" className="text-muted-foreground">
        Formato do player
      </span>
      <div
        role="radiogroup"
        aria-labelledby="formato-player"
        className="flex rounded-lg border bg-muted/40 p-0.5"
      >
        {PLAYER_SHAPES.map((shape) => (
          <button
            key={shape.value}
            type="button"
            role="radio"
            aria-checked={value === shape.value}
            title={shape.description}
            onClick={() => onChange(shape.value)}
            className={cn(
              "h-8 min-w-12 rounded-md px-3 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === shape.value && "bg-background font-medium text-foreground shadow-xs",
            )}
          >
            {shape.label}
            <span className="sr-only">, {shape.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

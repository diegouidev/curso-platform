"use client";

import { Loader2, Maximize, Minimize } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { usePlayerFullscreen } from "./use-player-fullscreen";
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
 * On phones the Drive embed renders its mobile layout: a ~50px bar above the 16:9 video and
 * a row of control "pills" (play, time, settings, fullscreen) that reaches ~30px below the
 * video. That layout is sized by the width, not by the iframe height, so a 16:9 box (or
 * 16:9 + 3rem) cuts the controls off. Narrow screens and touch screens up to tablet width get
 * 16:9 + 6rem; the spare space at the bottom is just black.
 */
const INLINE_BOX =
  "relative aspect-video overflow-hidden rounded-xl ring-1 ring-foreground/10 " +
  "max-sm:aspect-auto max-sm:pt-[calc(56.25%+6rem)] " +
  "max-lg:pointer-coarse:aspect-auto max-lg:pointer-coarse:pt-[calc(56.25%+6rem)]";
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
        className={cn("bg-black", fullscreen.active ? FULLSCREEN_BOX : INLINE_BOX)}
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
    </div>
  );
}

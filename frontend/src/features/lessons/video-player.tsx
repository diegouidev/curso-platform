"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type Ref } from "react";

import { cn } from "@/lib/utils";

import { VideoHelp } from "./video-help";

// After this long without the iframe's load event, the help hint gets more prominent.
const SLOW_LOAD_MS = 20_000;

type Props = {
  embedUrl: string;
  driveUrl: string;
  title: string;
  iframeRef?: Ref<HTMLIFrameElement>;
};

/**
 * The official Drive embed (/preview). It plays because this browser is signed in to the
 * Google account that has access; the app never downloads or re-hosts the video.
 *
 * The iframe is cross-origin: "load" also fires when Google shows an error or sign-in page,
 * so the app can't tell whether the video works. The help link is always available.
 */
export function VideoPlayer({ embedUrl, driveUrl, title, iframeRef }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [embedUrl, attempt]);

  return (
    <div className="grid gap-2">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-foreground/10">
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
      </div>
      <VideoHelp
        driveUrl={driveUrl}
        prominent={slow && !loaded}
        onReload={() => setAttempt((n) => n + 1)}
      />
    </div>
  );
}

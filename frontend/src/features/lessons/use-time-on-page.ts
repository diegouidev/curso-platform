import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { lessonKeys, sendHeartbeat } from "./api";

const FLUSH_EVERY_MS = 15_000;
const CHECK_EVERY_MS = 5_000;
// The API caps a heartbeat at 60 s; a larger backlog (after a network blip) goes in chunks.
const MAX_CHUNK_SECONDS = 60;

type Options = {
  lessonId: number;
  enabled: boolean;
  /** Time on the page already recorded by the server when the page opened. */
  initialSeconds: number;
  /** Total seconds (recorded + this visit) after which `onThreshold` fires, once per visit. */
  thresholdSeconds: number | null;
  onThreshold: () => void;
};

/**
 * Counts time on the lesson page while the tab is visible (Page Visibility API) and reports
 * it to the API: an opening ping, then every 15 s, and on hide/leave with `keepalive`.
 * The Drive iframe doesn't expose playback, so this is the only signal of study time.
 */
export function useTimeOnPage({
  lessonId,
  enabled,
  initialSeconds,
  thresholdSeconds,
  onThreshold,
}: Options): void {
  const queryClient = useQueryClient();
  const latest = useRef({ initialSeconds, thresholdSeconds, onThreshold });
  useEffect(() => {
    latest.current = { initialSeconds, thresholdSeconds, onThreshold };
  });

  useEffect(() => {
    if (!enabled) return;

    let serverSeconds = latest.current.initialSeconds;
    let unsentMs = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;
    let thresholdFired = false;

    const collect = () => {
      if (visibleSince === null) return;
      const now = Date.now();
      unsentMs += now - visibleSince;
      visibleSince = now;
    };

    const report = (seconds: number, keepalive = false) =>
      sendHeartbeat(queryClient, lessonId, seconds, { keepalive })
        .then((progress) => {
          serverSeconds = progress.time_on_page_seconds;
        })
        .catch(() => {
          // Keep the time for the next flush (network blip). Not retried after unmount.
          unsentMs += seconds * 1000;
        });

    const flush = (keepalive = false) => {
      collect();
      const seconds = Math.min(Math.floor(unsentMs / 1000), MAX_CHUNK_SECONDS);
      if (seconds < 1) return;
      unsentMs -= seconds * 1000;
      void report(seconds, keepalive);
    };

    const check = () => {
      collect();
      const { thresholdSeconds: threshold } = latest.current;
      if (thresholdFired || threshold == null) return;
      if (serverSeconds + unsentMs / 1000 >= threshold) {
        thresholdFired = true;
        latest.current.onThreshold();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibleSince = Date.now();
      } else {
        flush(true);
        visibleSince = null;
      }
    };
    const onPageHide = () => flush(true);

    // Opening ping: records "last opened" (for "continue where I left off").
    void sendHeartbeat(queryClient, lessonId, 0)
      .then((progress) => {
        serverSeconds = Math.max(serverSeconds, progress.time_on_page_seconds);
        return queryClient.invalidateQueries({ queryKey: lessonKeys.continueAll });
      })
      .catch(() => undefined);

    const flushTimer = window.setInterval(() => flush(), FLUSH_EVERY_MS);
    const checkTimer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(flushTimer);
      window.clearInterval(checkTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      flush(true);
    };
  }, [enabled, lessonId, queryClient]);
}

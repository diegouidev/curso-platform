/** "[12:30]" or "[1:02:09]" in a note: a moment of the lesson video. */
export const TIMESTAMP_PATTERN = /\[((?:\d{1,2}:)?\d{1,2}:[0-5]\d)\]/g;

/** "1:02:09" -> 3729 */
export function timestampSeconds(text: string): number {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * The Drive viewer at a given second (`?t=750s`), in the connected Google account. The
 * embedded player doesn't reliably honor a start time, so timestamps open the Drive tab.
 */
export function driveAtTime(driveUrl: string, seconds: number, email?: string | null): string {
  const url = new URL(driveUrl);
  url.searchParams.set("t", `${seconds}s`);
  if (email) url.searchParams.set("authuser", email);
  return url.toString();
}

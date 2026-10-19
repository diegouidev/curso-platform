/** "12:05" / "1:02:09" — for a single video. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "3 h 20 min" / "45 min" / "menos de 1 min" — for totals. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return "menos de 1 min";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "há 5 minutos", "ontem"… */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return relative.format(Math.round(diff / size), unit);
  }
  return "agora mesmo";
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

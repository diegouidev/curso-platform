import { ApiError, apiFetch } from "@/lib/api/client";

/** Downloads an authenticated API file, named by its Content-Disposition. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await apiFetch(path);
  if (!response.ok) throw new ApiError(response.status, null);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

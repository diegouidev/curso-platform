"use client";

import {
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Attachment } from "@/features/courses/api";

function iconFor(mimeType: string): LucideIcon {
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return Presentation;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv")
    return FileSpreadsheet;
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("document") ||
    mimeType.startsWith("text/")
  )
    return FileText;
  return File;
}

/** Materials (PDFs, Docs, Slides…): embedded preview in a dialog, or the Drive viewer in a new tab. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null);

  return (
    <>
      <ul className="grid gap-1">
        {attachments.map((attachment) => {
          const Icon = iconFor(attachment.mime_type);
          return (
            <li
              key={attachment.id}
              className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-muted/60"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <button
                type="button"
                onClick={() => setPreview(attachment)}
                className="min-w-0 flex-1 truncate rounded-sm py-2 text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {attachment.title}
                <span className="sr-only"> (visualizar)</span>
              </button>
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href={attachment.view_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Abrir ${attachment.title} no Drive (nova aba)`}
                >
                  <ExternalLink />
                </a>
              </Button>
            </li>
          );
        })}
      </ul>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="grid h-[min(85dvh,56rem)] grid-rows-[auto_1fr] sm:max-w-5xl">
          <DialogHeader className="pr-10">
            <DialogTitle className="truncate leading-snug">{preview?.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3">
              Visualização do Google Drive.
              {preview && (
                <a
                  href={preview.view_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1"
                >
                  Abrir em nova aba <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <iframe
              src={preview.preview_url}
              title={`Visualização: ${preview.title}`}
              allow="fullscreen"
              className="size-full rounded-lg border bg-muted"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

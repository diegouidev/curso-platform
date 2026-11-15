import { Clock } from "lucide-react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

import { TIMESTAMP_PATTERN, timestampSeconds } from "@/lib/timestamps";
import { cn } from "@/lib/utils";

type Plugin = NonNullable<Options["remarkPlugins"]>[number];
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string> };
};

/** Turns "[12:30]" in plain text (not in code or inside links) into links to that moment. */
function remarkTimestamps(options: { href: (seconds: number) => string }) {
  const split = (text: string): MdNode[] => {
    const nodes: MdNode[] = [];
    let last = 0;
    for (const match of text.matchAll(TIMESTAMP_PATTERN)) {
      const start = match.index ?? 0;
      if (start > last) nodes.push({ type: "text", value: text.slice(last, start) });
      nodes.push({
        type: "link",
        url: options.href(timestampSeconds(match[1] ?? "")),
        children: [{ type: "text", value: match[1] ?? "" }],
        data: { hProperties: { "data-timestamp": "true" } },
      });
      last = start + match[0].length;
    }
    if (last < text.length) nodes.push({ type: "text", value: text.slice(last) });
    return nodes;
  };

  const walk = (node: MdNode) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text" && child.value) return split(child.value);
      walk(child);
      return [child];
    });
  };

  return (tree: MdNode) => walk(tree);
}

/**
 * A single line break in a note is kept (like a GitHub comment), so a "P:" line and its
 * "R:" line don't merge into one paragraph. Code blocks are not text nodes: untouched.
 */
function remarkSoftBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text" && child.value?.includes("\n")) {
        return child.value
          .split("\n")
          .flatMap((part, index): MdNode[] =>
            index === 0
              ? [{ type: "text", value: part }]
              : [{ type: "break" }, { type: "text", value: part }],
          );
      }
      walk(child);
      return [child];
    });
  };
  return (tree: MdNode) => walk(tree);
}

const components: Components = {
  // Notes may link out (docs, repos); never navigate away from the player.
  a: ({ node: _node, children, ...props }) =>
    "data-timestamp" in props ? (
      <a
        {...props}
        target="_blank"
        rel="noreferrer"
        title="Abrir o vídeo no Drive neste ponto"
        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-foreground tabular-nums no-underline hover:bg-muted/70"
      >
        <Clock className="size-3" aria-hidden />
        {children}
      </a>
    ) : (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
};

/**
 * Renders the user's own markdown (GFM: tables, task lists, strikethrough). Raw HTML is not
 * rendered (react-markdown escapes it), so a note can't inject markup. Single line breaks are
 * kept. With `timestampHref`,
 * "[12:30]" becomes a link to that moment of the video.
 */
export function Markdown({
  children,
  className,
  timestampHref,
}: {
  children: string;
  className?: string;
  timestampHref?: (seconds: number) => string;
}) {
  const plugins: Plugin[] = [remarkGfm, remarkSoftBreaks as unknown as Plugin];
  if (timestampHref) {
    plugins.push([remarkTimestamps, { href: timestampHref }] as unknown as Plugin);
  }
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:break-words prose-pre:bg-muted prose-pre:text-foreground",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

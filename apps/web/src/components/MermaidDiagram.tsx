import { useEffect, useState, type ReactNode } from "react";

import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";

type MermaidModule = typeof import("mermaid").default;

const MAX_DIAGRAM_CACHE_ENTRIES = 200;
const MAX_DIAGRAM_CACHE_MEMORY_BYTES = 8 * 1024 * 1024;

const renderedDiagramCache = new LRUCache<string>(
  MAX_DIAGRAM_CACHE_ENTRIES,
  MAX_DIAGRAM_CACHE_MEMORY_BYTES,
);

let mermaidPromise: Promise<MermaidModule> | null = null;
let renderSequence = 0;

/** Mermaid is heavy, so it only downloads once the first diagram is rendered. */
function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise == null) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        fontFamily: "inherit",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function createDiagramCacheKey(code: string, theme: "light" | "dark"): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${theme}`;
}

/** The theme rides along as an init directive so light and dark diagrams can
    share one mermaid instance without re-initializing between renders. */
function withThemeDirective(code: string, theme: "light" | "dark"): string {
  const mermaidTheme = theme === "dark" ? "dark" : "default";
  return `%%{init: {"theme": "${mermaidTheme}"}}%%\n${code}`;
}

export async function renderMermaidDiagram(code: string, theme: "light" | "dark"): Promise<string> {
  const cacheKey = createDiagramCacheKey(code, theme);
  const cached = renderedDiagramCache.get(cacheKey);
  if (cached != null) {
    return cached;
  }
  const mermaid = await loadMermaid();
  renderSequence += 1;
  const { svg } = await mermaid.render(
    `chat-markdown-mermaid-${renderSequence}`,
    withThemeDirective(code, theme),
  );
  renderedDiagramCache.set(cacheKey, svg, svg.length * 2);
  return svg;
}

type DiagramState =
  | { readonly status: "pending" }
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "failed"; readonly message: string };

/**
 * Renders a fenced `mermaid` block as an inline SVG. Shows `fallback` (the
 * plain code) while mermaid loads and whenever the diagram fails to parse, so
 * a broken diagram never hides the text the agent wrote.
 */
export function MermaidDiagram({
  code,
  theme,
  fallback,
}: {
  code: string;
  theme: "light" | "dark";
  fallback: ReactNode;
}) {
  const [state, setState] = useState<DiagramState>({ status: "pending" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "pending" });
    renderMermaidDiagram(code, theme).then(
      (svg) => {
        if (!cancelled) {
          setState({ status: "rendered", svg });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (state.status === "rendered") {
    return (
      <div
        className="chat-markdown-mermaid"
        role="img"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <>
      {fallback}
      {state.status === "failed" ? (
        <p className="chat-markdown-mermaid-error" role="status">
          Diagram could not be rendered: {state.message.split("\n")[0]}
        </p>
      ) : null}
    </>
  );
}

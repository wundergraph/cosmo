import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { downloadStringAsFile } from "@/lib/download-string-as-file";
import { cn } from "@/lib/utils";
import { ClipboardCopyIcon, DownloadIcon } from "@radix-ui/react-icons";
import copy from "copy-to-clipboard";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Highlight,
  LineInputProps,
  LineOutputProps,
  Token,
  TokenInputProps,
  TokenOutputProps,
  themes,
} from "prism-react-renderer";
import { Button } from "./ui/button";
import { useToast } from "./ui/use-toast";
import { CSSProperties, useEffect, useRef, useState } from "react";
import graphQLPlugin from "prettier/plugins/graphql";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import * as prettier from "prettier/standalone";
import * as Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-graphql";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollIntoView } from "./schema/sdl-viewer";

export const CodeViewerActions = ({
  code,
  subgraphName,
  className,
  variant = "secondary",
  size = "default",
  extension = "graphql",
}: {
  code: string;
  subgraphName: string;
  className?: string;
  variant?: any;
  size?: any;
  extension?: "graphql" | "json";
}) => {
  const { toast, dismiss } = useToast();

  const downloadSDL = () => {
    downloadStringAsFile(
      code,
      `${subgraphName}.${extension}`,
      `application/${extension}`,
    );
  };

  const copySDL = () => {
    copy(code);
    const { id } = toast({ description: "Copied contents to clipboard" });

    const t = setTimeout(() => {
      dismiss(id);
    }, 2000);

    return () => clearTimeout(t);
  };

  return (
    <div
      className={cn("flex w-full items-center gap-x-2 md:w-auto", className)}
    >
      <Button
        variant={variant}
        size={size}
        className="flex-1"
        onClick={() => copySDL()}
      >
        <ClipboardCopyIcon className="mr-3" />
        Copy
      </Button>
      <Button
        variant={variant}
        size={size}
        className="flex-1"
        onClick={downloadSDL}
      >
        <DownloadIcon className="mr-3" />
        Download
      </Button>
    </div>
  );
};

export const CodeViewer = ({
  code,
  disableLinking,
  className,
  language = "graphql",
}: {
  code: string;
  disableLinking?: boolean;
  className?: string;
  language?: "graphql" | "json";
}) => {
  const router = useRouter();
  const pathname = router.asPath.split("#")[0];
  const hash = router.asPath.split("#")?.[1];

  const [content, setContent] = useState("");

  useEffect(() => {
    const set = async (source: string) => {
      try {
        const res = await prettier.format(source, {
          parser: language,
          plugins: [graphQLPlugin, estreePlugin, babelPlugin],
        });
        setContent(res);
      } catch {
        setContent("INVALID CONTENT");
      }
    };

    if (!code) return;
    set(code);
  }, [code, language]);

  const selectedTheme = useResolvedTheme();

  return (
    <Highlight
      theme={selectedTheme === "dark" ? themes.nightOwl : themes.nightOwlLight}
      code={content}
      language={language}
      prism={Prism}
    >
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre
          style={{ ...style, background: "", backgroundColor: "" }}
          className={cn("py-4 text-xs", className)}
        >
          {tokens.map((line, i, allLines) => {
            const numberSectionWidth =
              allLines.length > 10
                ? allLines.length > 100
                  ? allLines.length > 1000
                    ? "w-18"
                    : "w-16"
                  : "w-12"
                : "w-8";

            const lineNo = `L${i + 1}`;

            const href = disableLinking ? "#" : pathname + `#${lineNo}`;

            return (
              <div
                id={`id-${lineNo}`}
                key={i.toString()}
                {...getLineProps({ line })}
                className={hash === lineNo ? "bg-secondary" : ""}
              >
                <Link
                  href={href}
                  className={cn(
                    "sticky left-0 mr-4 inline-block select-none border-r bg-background pr-2 text-right text-muted-foreground",
                    numberSectionWidth,
                  )}
                >
                  <span>{i + 1}</span>
                </Link>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
};

const CodeBlock = ({
  style,
  tokens,
  getLineProps,
  getTokenProps,
  className,
}: {
  style: CSSProperties;
  tokens: Token[][];
  getLineProps: (input: LineInputProps) => LineOutputProps;
  getTokenProps: (input: TokenInputProps) => TokenOutputProps;
  className?: string;
}) => {
  const router = useRouter();
  const pathname = router.asPath.split("#")[0];
  const hash = router.asPath.split("#")?.[1];

  const parentRef = useRef<HTMLPreElement>(null);
  const count = tokens.length;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 250,
  });

  useScrollIntoView(virtualizer, hash ? Number(hash.slice(1)) : 0);

  const items = virtualizer.getVirtualItems();

  return (
    <pre
      id="schema-container"
      ref={parentRef}
      style={{ ...style, background: "", backgroundColor: "" }}
      className={cn("h-full overflow-auto text-xs", className)}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${items[0]?.start ?? 0}px)`,
          }}
        >
          {items.map((virtualRow) => {
            const line = tokens[virtualRow.index];
            const allLines = count;
            const i = virtualRow.index;

            const numberSectionWidth =
              allLines > 10
                ? allLines > 100
                  ? allLines > 1000
                    ? "w-18"
                    : "w-16"
                  : "w-12"
                : "w-8";

            const lineNo = `L${i + 1}`;

            const href = pathname + `#${lineNo}`;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              >
                <div
                  id={`id-${lineNo}`}
                  key={i.toString()}
                  {...getLineProps({ line })}
                  className={cn(
                    getLineProps({ line }).className,
                    "group",
                    hash === lineNo && "w-screen bg-secondary",
                  )}
                >
                  <Link
                    href={href}
                    className={cn(
                      "border-sr relative left-0 mr-4 inline-flex select-none items-center justify-end space-x-2 py-px pr-2 text-right text-muted-foreground",
                      i === 0 && "pt-2",
                      numberSectionWidth,
                    )}
                  >
                    <span>{i + 1}</span>
                  </Link>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </pre>
  );
};

export const CodeViewerWithVirtualizer = ({
  code,
  className,
  language = "graphql",
  disablePrettier,
}: {
  code: string;
  className?: string;
  language?: "graphql" | "json";
  disablePrettier: boolean;
}) => {
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!code) return;
    if (disablePrettier) {
      setContent(code);
      return;
    }
    const set = async (source: string) => {
      try {
        const res = await prettier.format(source, {
          parser: language,
          plugins: [graphQLPlugin, estreePlugin, babelPlugin],
        });
        setContent(res);
      } catch {
        setContent("INVALID CONTENT");
      }
    };

    set(code);
  }, [code, disablePrettier, language]);

  const selectedTheme = useResolvedTheme();

  return (
    <Highlight
      theme={selectedTheme === "dark" ? themes.nightOwl : themes.nightOwlLight}
      code={content}
      language={language}
      prism={Prism}
    >
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <CodeBlock
          style={style}
          tokens={tokens}
          getLineProps={getLineProps}
          getTokenProps={getTokenProps}
          className={className}
        />
      )}
    </Highlight>
  );
};

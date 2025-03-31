import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { downloadStringAsFile } from "@/lib/download-string-as-file";
import { cn } from "@/lib/utils";
import {
  ClipboardCopyIcon,
  DotsHorizontalIcon,
  DownloadIcon,
} from "@radix-ui/react-icons";
import { Virtualizer, useVirtualizer } from "@tanstack/react-virtual";
import copy from "copy-to-clipboard";
import Link from "next/link";
import { useRouter } from "next/router";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import {
  Highlight,
  LineInputProps,
  LineOutputProps,
  Token,
  TokenInputProps,
  TokenOutputProps,
  themes,
} from "prism-react-renderer";
import * as Prism from "prismjs";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-json";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";

export const SDLViewerActions = ({
  sdl,
  className,
  size = "icon",
  targetName,
}: {
  sdl: string;
  className?: string;
  size?: "icon" | "icon-sm";
  targetName?: string;
}) => {
  const { toast, dismiss } = useToast();

  const downloadSDL = () => {
    downloadStringAsFile(
      sdl,
      targetName ? `${targetName}.graphql` : `schema.graphql`,
      `application/graphql`,
    );
  };

  const copySDL = () => {
    copy(sdl);
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
      <Button variant="secondary" size={size} onClick={() => copySDL()}>
        <ClipboardCopyIcon />
      </Button>
      <Button variant="secondary" size={size} onClick={downloadSDL}>
        <DownloadIcon />
      </Button>
    </div>
  );
};

const LineActions = ({ lineNo }: { lineNo: number }) => {
  const router = useRouter();
  const { toast } = useToast();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="secondary"
          className="invisible absolute left-1.5 !h-auto !rounded-sm group-hover:visible data-[state=open]:visible"
        >
          <DotsHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            copy(`${window.location.href.split("#")[0]}#L${lineNo}`);
            toast({
              description: "Copied link to clipboard",
            });
          }}
        >
          Copy link to line
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const useScrollIntoView = (
  virtualizer: Virtualizer<any, any>,
  lineNo: number,
) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!isMounted && lineNo) {
        virtualizer.scrollToIndex(lineNo + 5);
        setIsMounted(true);
      }
    }, 500);
    return () => {
      clearTimeout(t);
    };
  }, [isMounted, lineNo, virtualizer]);
};

const Block = ({
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

  function calculateSectionWidth(n: number) {
    if (n >= 100000) {
      return "w-16";
    } else if (n >= 1000) {
      return "w-12";
    } else {
      return "w-10";
    }
  }

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

            const numberSectionWidth = calculateSectionWidth(allLines);

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
                    <LineActions lineNo={i + 1} />
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

export const SDLViewer = ({
  sdl,
  className,
}: {
  sdl: string;
  className?: string;
}) => {
  const [content, setContent] = useState("");

  useEffect(() => {
    const set = async (source: string) => {
      try {
        const res = await prettier.format(source, {
          parser: "graphql",
          plugins: [graphQLPlugin, estreePlugin, babelPlugin],
        });
        setContent(res);
      } catch {
        setContent("INVALID CONTENT");
      }
    };

    if (!sdl) return;
    set(sdl);
  }, [sdl]);

  const selectedTheme = useResolvedTheme();

  return (
    <Highlight
      theme={selectedTheme === "dark" ? themes.nightOwl : themes.nightOwlLight}
      code={content}
      language="graphql"
      prism={Prism}
    >
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <Block
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

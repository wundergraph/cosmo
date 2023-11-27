import { downloadStringAsFile } from "@/lib/download-string-as-file";
import { cn } from "@/lib/utils";
import { ClipboardCopyIcon, DownloadIcon } from "@radix-ui/react-icons";
import copy from "copy-to-clipboard";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/router";
import { Highlight, themes } from "prism-react-renderer";
import { useMemo } from "react";
import { Button } from "./ui/button";
import { useToast } from "./ui/use-toast";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

export const SchemaViewerActions = ({
  sdl,
  subgraphName,
  className,
  variant = "secondary",
  size = "default",
}: {
  sdl: string;
  subgraphName: string;
  className?: string;
  variant?: any;
  size?: any;
}) => {
  const { toast, dismiss } = useToast();

  const downloadSDL = () => {
    downloadStringAsFile(sdl, `${subgraphName}.graphql`, "application/graphql");
  };

  const copySDL = () => {
    copy(sdl);
    const { id } = toast({ description: "Copied SDL to clipboard" });

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

export const SchemaViewer = ({
  sdl,
  disableLinking,
  className,
}: {
  sdl: string;
  disableLinking?: boolean;
  className?: string;
}) => {
  const router = useRouter();
  const pathname = router.asPath.split("#")[0];
  const hash = router.asPath.split("#")?.[1];

  const selectedTheme = useResolvedTheme();

  return (
    <Highlight
      theme={selectedTheme === "dark" ? themes.nightOwl : themes.nightOwlLight}
      code={sdl}
      language="graphql"
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

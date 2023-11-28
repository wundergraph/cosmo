import { cn } from "@/lib/utils";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { Highlight, themes } from "prism-react-renderer";
import * as Prism from "prismjs";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-json";
import { useEffect, useState } from "react";

export const CodeViewer = ({
  code,
  className,
  language = "graphql",
}: {
  code: string;
  className?: string;
  language?: "graphql" | "json";
}) => {
  const [content, setContent] = useState("");

  useEffect(() => {
    const set = async (source: string) => {
      const res = await prettier.format(source, {
        parser: language,
        plugins: [graphQLPlugin, estreePlugin, babelPlugin],
      });
      setContent(res);
    };

    if (!code) return;
    set(code);
  }, [code, language]);

  return (
    <Highlight
      theme={themes.nightOwl}
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

            return (
              <div
                id={`id-${lineNo}`}
                key={i.toString()}
                {...getLineProps({ line })}
              >
                <div
                  className={cn(
                    "sticky left-0 mr-4 inline-block select-none border-r bg-background pr-2 text-right text-muted-foreground",
                    numberSectionWidth
                  )}
                >
                  <span>{i + 1}</span>
                </div>
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

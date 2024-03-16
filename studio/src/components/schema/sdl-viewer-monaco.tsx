import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import Editor, { DiffEditor, useMonaco, loader } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import { schemaViewerDarkTheme } from "./monaco-dark-theme";
import { Loader } from "@/components/ui/loader";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";

/*
 * In order to load the Monaco Editor locally and avoid fetching it from a CDN
 * (the default CDN is https://cdn.jsdelivr.net), the monaco-editor bundle was
 * copied into the "public" folder from node_modules, and we called the
 * loader.config method below to reference it.
 *
 * This also avoid specifying the CDN origin in the CSP headers.
 *
 * We can also use this method to load the Monaco Editor from a different
 * CDN like Cloudflare.
 */
loader.config({
  paths: {
    // Load Monaco Editor from "public" directory
    vs: "/monaco-editor/min/vs",
    // Load Monaco Editor from different CDN
    // vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.43.0/min/vs',
  },
});

export interface DecorationCollection {
  range: {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
  };
  options: {
    hoverMessage?: {
      value: string;
    };
    className?: string;
    inlineClassName?: string;
    isWholeLine: boolean;
  };
}

export const SDLViewerMonaco = ({
  schema,
  newSchema,
  line,
  decorationCollections,
  disablePrettier,
}: {
  schema: string;
  newSchema?: string;
  line?: number;
  decorationCollections?: DecorationCollection[];
  disablePrettier?: boolean;
}) => {
  const selectedTheme = useResolvedTheme();

  const [content, setContent] = useState("");
  const [newContent, setNewContent] = useState("");

  useEffect(() => {
    if (!schema) return;
    if (disablePrettier) {
      setContent(schema);
      return;
    }
    const set = async (source: string, setter: (val: string) => void) => {
      try {
        const res = await prettier.format(source, {
          parser: "graphql",
          plugins: [graphQLPlugin, estreePlugin, babelPlugin],
        });
        setter(res);
      } catch {
        setter("INVALID CONTENT");
      }
    };

    set(schema, setContent);

    if (newSchema) {
      set(newSchema, setNewContent);
    }
  }, [schema, newSchema, disablePrettier]);

  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) return;
    if (selectedTheme === "dark") {
      monaco.editor.setTheme("wg-dark");
    } else {
      monaco.editor.setTheme("light");
    }
  }, [selectedTheme, monaco]);

  if (newSchema) {
    return (
      <DiffEditor
        theme={selectedTheme === "dark" ? "wg-dark" : "light"}
        className="scrollbar-custom h-full flex-shrink font-mono text-xs"
        language="graphql"
        original={content}
        modified={newContent}
        options={{
          readOnly: true,
          domReadOnly: true,
          contextmenu: false,
          minimap: {
            enabled: false,
          },
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          smoothScrolling: true,
          padding: {
            top: 12,
          },
        }}
        onMount={(editor, monaco) => {
          monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
          if (selectedTheme === "dark") {
            monaco.editor.setTheme("wg-dark");
          }
        }}
      />
    );
  }

  return (
    <Editor
      theme={selectedTheme === "dark" ? "wg-dark" : "light"}
      className="scrollbar-custom h-full text-xs"
      language="graphql"
      value={content}
      loading={<Loader fullscreen />}
      options={{
        automaticLayout: true,
        readOnly: true,
        domReadOnly: true,
        contextmenu: false,
        language: "graphql",
        minimap: {
          enabled: false,
        },
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
        },
        smoothScrolling: true,
        padding: {
          top: 12,
        },
      }}
      onMount={(editor, monaco) => {
        monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
        if (selectedTheme === "dark") {
          monaco.editor.setTheme("wg-dark");
        }
        const decorations: DecorationCollection[] = decorationCollections || [];

        if (line) {
          decorations.push({
            range: {
              startLineNumber: line,
              endLineNumber: line,
              startColumn: 1,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: "bg-green-500 bg-opacity-40 w-full h-32 z-25",
            },
          });

          const y = editor.getTopForLineNumber(line - 5);
          editor.setScrollPosition({ scrollTop: y - 10 });
        }
        editor.createDecorationsCollection(decorations);
      }}
    />
  );
};

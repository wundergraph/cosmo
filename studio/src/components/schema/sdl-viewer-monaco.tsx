import { Loader } from "@/components/ui/loader";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import Editor, { DiffEditor, loader, useMonaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { useCallback, useEffect, useRef, useState } from "react";
import { schemaViewerDarkTheme } from "./monaco-dark-theme";

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

export const SDLViewerMonaco = ({
  schema,
  newSchema,
  line,
  decorationCollections,
  disablePrettier,
  enableLinking = false,
}: {
  schema: string;
  newSchema?: string;
  line?: number;
  decorationCollections?: DecorationCollection[];
  disablePrettier?: boolean;
  enableLinking?: boolean;
}) => {
  const selectedTheme = useResolvedTheme();

  const [content, setContent] = useState("");
  const [newContent, setNewContent] = useState("");
  const [didMoveToLine, setDidMoveToLine] = useState(false);

  useEffect(() => {
    if (newSchema !== undefined) {
      if (disablePrettier) {
        setNewContent(newSchema);
      } else {
        set(newSchema, setNewContent);
      }
    }
    if (!schema) return;
    if (disablePrettier) {
      setContent(schema);
      return;
    }

    set(schema, setContent);
  }, [schema, newSchema, disablePrettier]);

  const monaco = useMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const resetDecorations = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const editorModel = editor.getModel();
    if (editorModel) {
      const existingDecorations = editor.getDecorationsInRange(
        editorModel.getFullModelRange(),
      );

      if (existingDecorations) {
        editor.removeDecorations(existingDecorations.map((d) => d.id));
      }
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
          className: "bg-success bg-opacity-40 w-full h-32 z-25",
        },
      });

      if (!didMoveToLine) {
        const y = editor.getTopForLineNumber(line - 5);
        editor.setScrollPosition({ scrollTop: y - 10 });

        setDidMoveToLine(true);
      }
    }

    editor.createDecorationsCollection(decorations);
  }, [decorationCollections, didMoveToLine, line]);

  useEffect(() => {
    resetDecorations();
  }, [decorationCollections, line, monaco, resetDecorations]);

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
        onMount={(_, monaco) => {
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
        glyphMargin: !!enableLinking,
        folding: false,
        selectOnLineNumbers: false,
      }}
      onMount={(editor, monaco) => {
        editorRef.current = editor;

        resetDecorations();

        monaco.editor.defineTheme("wg-dark", schemaViewerDarkTheme);
        if (selectedTheme === "dark") {
          monaco.editor.setTheme("wg-dark");
        }

        if (!enableLinking) {
          return;
        }

        editor.onMouseMove((e) => {
          const lineNumber = e.target.position?.lineNumber;

          if (e.target.position && lineNumber) {
            const existingAnchor = document.getElementById(
              `anchor-${lineNumber}`,
            );
            if (!existingAnchor) {
              editor.changeViewZones((changeAccessor) => {
                const domNode = document.createElement("div");

                const marginDomNode = document.createElement("div");
                marginDomNode.className = "mdn z-30";

                const wrapper = document.createElement("div");
                wrapper.className = "pl-2";
                marginDomNode.appendChild(wrapper);

                const anchor = document.createElement("a");
                anchor.href = `#L${lineNumber}`;
                anchor.id = "anchor-" + lineNumber;
                anchor.className = "h-10 cursor-pointer w-full";
                anchor.innerHTML = `
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                      </svg>
                   `;

                wrapper.appendChild(anchor);

                changeAccessor.addZone({
                  afterLineNumber: lineNumber - 1,
                  heightInLines: 0,
                  domNode,
                  marginDomNode,
                });
              });
            }

            // remove anchors that are not for the currently hovered over line
            Array.from(document.getElementsByClassName("mdn z-30"))
              .filter((ele) => {
                const anchor = ele.firstElementChild?.firstElementChild;
                if (anchor) {
                  const line = Number(anchor.id.split("-")[1]);
                  if (line === lineNumber) {
                    return false;
                  }
                }
                return true;
              })
              .forEach((ele) => ele.remove());
          }
        });
      }}
    />
  );
};

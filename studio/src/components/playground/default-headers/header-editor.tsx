import { useResolvedTheme } from '@/hooks/use-resolved-theme';
import { cn } from '@/lib/utils';
import Editor, { loader } from '@monaco-editor/react';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { schemaViewerDarkTheme } from '../../schema/monaco-dark-theme';

loader.config({
  paths: {
    // Load Monaco Editor from "public" directory
    vs: '/monaco-editor/min/vs',
  },
});

const LINE_HEIGHT = 20;
const MIN_LINES = 4;
const MAX_LINES = 12;

/**
 * Grows with the document so a two-header list is not framed by empty space. The
 * wrapper's padding supplies the breathing room, so this is the text height alone.
 */
const editorHeight = (value: string) => {
  const lines = value === '' ? 0 : value.split('\n').length;

  return Math.min(Math.max(lines, MIN_LINES), MAX_LINES) * LINE_HEIGHT;
};

export interface HeaderEditorProps {
  value: string;
  /** The parse error to surface, or null while the contents are valid. */
  error: string | null;
  readOnly?: boolean;
  onChange: (value: string) => void;
}

/**
 * A JSON editor for a single scope's default headers, matching how headers are
 * written in the playground's own headers tab.
 */
export const HeaderEditor = ({ value, error, readOnly = false, onChange }: HeaderEditorProps) => {
  const selectedTheme = useResolvedTheme();

  return (
    <div className="space-y-1.5">
      {/* Mirrors the styling of `ui/input`: the border, hover and focus treatment are
          what tell the user this is something to type into rather than a code block.
          Background is left to Monaco's own theme, which paints over anything set here. */}
      <div
        className={cn(
          'overflow-hidden rounded-md border border-input py-2 shadow-sm transition-colors',
          readOnly ? 'cursor-not-allowed opacity-60' : 'hover:border-input-active',
          // Tailwind emits `hover` after `focus-within` at equal specificity, so hover
          // would otherwise win while the editor is focused. The paired variant makes
          // the focus border stick regardless of where the pointer is.
          !readOnly && !error && 'focus-within:border-primary focus-within:hover:border-primary',
          error && 'border-destructive',
        )}
      >
        <Editor
          height={editorHeight(value)}
          language="json"
          value={value}
          loading={null}
          theme={selectedTheme === 'dark' ? 'wg-dark' : 'light'}
          onChange={(next) => onChange(next ?? '')}
          options={{
            readOnly,
            automaticLayout: true,
            fontSize: 13,
            lineHeight: LINE_HEIGHT,
            minimap: { enabled: false },
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            renderLineHighlight: 'none',
            guides: { indentation: false },
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
              useShadows: false,
              alwaysConsumeMouseWheel: false,
            },
            // Line numbers are the other half of the "this is an editor" signal, and
            // they are what separates these boxes from the read-only preview below.
            lineNumbers: 'on',
            lineNumbersMinChars: 2,
            lineDecorationsWidth: 8,
            folding: false,
            scrollBeyondLastLine: false,
          }}
          onMount={(_, monaco) => {
            monaco.editor.defineTheme('wg-dark', schemaViewerDarkTheme);
            if (selectedTheme === 'dark') {
              monaco.editor.setTheme('wg-dark');
            }
          }}
        />
      </div>
      {error && (
        <p className="flex items-center gap-x-1.5 text-xs text-destructive">
          <ExclamationTriangleIcon className="h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

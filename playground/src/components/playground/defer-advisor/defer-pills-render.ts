import type { EditorContextType } from '@graphiql/react';
import { PROBE_RUNS } from './probe';
import { FieldPill } from './defer-pills';

export type QueryEditor = NonNullable<EditorContextType['queryEditor']>;

export const renderPills = (editor: QueryEditor, pills: FieldPill[]): (() => void) => {
  const doc = editor.getDoc();
  const markers = pills.map((pill) => {
    const widget = document.createElement('span');
    widget.textContent = `${pill.latencyMs}ms`;
    widget.title = `${pill.fieldName}: ${pill.latencyMs}ms average over ${PROBE_RUNS} runs`;
    widget.style.cssText = [
      'margin-left: 6px',
      'padding: 0 6px',
      'border-radius: 9999px',
      'font-size: 11px',
      'line-height: 16px',
      'white-space: nowrap',
      pill.slow
        ? 'background: rgba(239, 68, 68, 0.18); color: rgb(220, 38, 38)'
        : 'background: rgba(34, 197, 94, 0.18); color: rgb(22, 163, 74)',
    ].join(';');

    return editor.setBookmark(doc.posFromIndex(pill.offset), { widget, insertLeft: false });
  });

  return () => markers.forEach((marker) => marker.clear());
};

import type { EditorContextType } from '@graphiql/react';
import { PROBE_RUNS } from './probe';
import { FieldPill } from './defer-pills';

export type QueryEditor = NonNullable<EditorContextType['queryEditor']>;

const createPillElement = (pill: FieldPill): HTMLElement => {
  const widget = document.createElement('span');
  widget.className = 'defer-pill';
  widget.textContent = `${pill.latencyMs}ms`;
  widget.title = `${pill.fieldName}: ${pill.latencyMs}ms average over ${PROBE_RUNS} runs`;
  widget.dataset.slow = String(pill.slow);
  return widget;
};

export const renderPills = (editor: QueryEditor, pills: FieldPill[]): (() => void) => {
  const doc = editor.getDoc();
  const markers = pills.map((pill) =>
    editor.setBookmark(doc.posFromIndex(pill.offset), { widget: createPillElement(pill), insertLeft: false }),
  );

  return () => markers.forEach((marker) => marker.clear());
};

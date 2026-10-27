import type { EditorContextType } from '@graphiql/react';
import { PROBE_RUNS } from './probe';
import { FieldPill } from './defer-pills';

export type QueryEditor = NonNullable<EditorContextType['queryEditor']>;

// Parsed once on first use, then cloned. Created lazily so importing this module never touches the DOM.
let pillTemplate: HTMLTemplateElement | undefined;

const cloneTemplate = (): HTMLElement => {
  pillTemplate ??= Object.assign(document.createElement('template'), {
    innerHTML: '<span class="defer-pill"></span>',
  });
  const element = pillTemplate.content.firstElementChild?.cloneNode(true);
  if (!(element instanceof HTMLElement)) {
    throw new Error('Defer pill template did not produce an element');
  }
  return element;
};

const createPillElement = (pill: FieldPill): HTMLElement => {
  const widget = cloneTemplate();
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

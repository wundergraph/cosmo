import { slowFieldNames } from './analysis';
import { computeFieldPills } from './defer-pills';
import { QueryEditor, renderPills } from './defer-pills-render';
import { getOperation, parseQuery } from './operation';

// Lives outside React: GraphiQL unmounts plugin content when its tab closes.
export class PillController {
  latencies: Record<string, number> | null = null;

  private clear: (() => void) | undefined;
  private frame: number | undefined;
  private writing = false;
  private readonly listeners = new Set<() => void>();

  private readonly onChange = () => this.onEditorChange();

  constructor(private readonly editor: QueryEditor) {
    editor.on('change', this.onChange);
  }

  // The controller is cached per editor, so whoever owns it must dispose it, or the listener outlives its UI.
  dispose() {
    this.editor.off('change', this.onChange);
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.clear?.();
    this.clear = undefined;
  }

  writeQuery(text: string) {
    this.writing = true;
    try {
      this.editor.setValue(text);
    } finally {
      this.writing = false;
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setLatencies(latencies: Record<string, number> | null) {
    this.latencies = latencies;
    this.listeners.forEach((listener) => listener());
    this.render();
  }

  private onEditorChange() {
    if (this.latencies === null) {
      return;
    }
    if (!this.writing) {
      this.setLatencies(null);
      return;
    }
    this.scheduleRender();
  }

  private scheduleRender() {
    if (this.frame !== undefined) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.render();
    });
  }

  private render() {
    this.clear?.();
    this.clear = undefined;

    const text = this.editor.getValue();
    const operation = getOperation(parseQuery(text)?.doc)?.operation;
    if (!this.latencies || (operation !== undefined && operation !== 'query')) {
      return;
    }

    const slowNames = slowFieldNames(this.latencies);
    try {
      this.clear = renderPills(this.editor, computeFieldPills(text, this.latencies, slowNames));
    } catch {}
  }
}

const controllers = new WeakMap<QueryEditor, PillController>();

export const getPillController = (editor: QueryEditor): PillController => {
  let controller = controllers.get(editor);
  if (!controller) {
    controller = new PillController(editor);
    controllers.set(editor, controller);
  }
  return controller;
};

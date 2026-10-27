import { slowFieldNames } from './analysis';
import { computeFieldPills } from './defer-pills';
import { QueryEditor, renderPills } from './defer-pills-render';
import { getOperation, parseQuery } from './operation';

export type AnalysisState = {
  latencies: Record<string, number> | null;
  probeFailures: Record<string, string>;
  error: string | null;
  running: boolean;
};

export const initialAnalysis: AnalysisState = { latencies: null, probeFailures: {}, error: null, running: false };

// One per editor. Lives outside React: GraphiQL unmounts plugin content when its tab closes,
// and the latencies have to survive that and reach both the panel and the editor pills.
export class DeferController {
  private state: AnalysisState = initialAnalysis;

  private clearPills: (() => void) | undefined;
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
    this.clearPills?.();
    this.clearPills = undefined;
  }

  // Replaced on every change, so useSyncExternalStore sees a new reference exactly when something moved.
  get snapshot(): AnalysisState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  writeQuery(text: string) {
    this.writing = true;
    try {
      this.editor.setValue(text);
    } finally {
      this.writing = false;
    }
  }

  startAnalysis(variablesError: string | null) {
    this.update({ running: true, error: variablesError });
  }

  finishAnalysis(latencies: Record<string, number>, probeFailures: Record<string, string>) {
    this.update({ latencies, probeFailures, running: false });
  }

  failAnalysis(message: string) {
    this.update({ latencies: null, error: message, running: false });
  }

  setRunning(running: boolean) {
    this.update({ running });
  }

  clear() {
    this.update({ latencies: null, probeFailures: {}, error: null });
  }

  private update(patch: Partial<AnalysisState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
    if ('latencies' in patch) {
      this.render();
    }
  }

  // A manual edit makes the numbers stale. A write from the panel (defer or revert) keeps them,
  // because the root fields are the same and only the directives moved.
  private onEditorChange() {
    if (this.state.latencies === null) {
      return;
    }
    if (!this.writing) {
      this.clear();
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
    this.clearPills?.();
    this.clearPills = undefined;

    const { latencies } = this.state;
    const text = this.editor.getValue();
    const operation = getOperation(parseQuery(text)?.doc)?.operation;
    if (!latencies || (operation !== undefined && operation !== 'query')) {
      return;
    }

    const slowNames = slowFieldNames(latencies);
    try {
      this.clearPills = renderPills(this.editor, computeFieldPills(text, latencies, slowNames));
    } catch {}
  }
}

const controllers = new WeakMap<QueryEditor, DeferController>();

export const getDeferController = (editor: QueryEditor): DeferController => {
  let controller = controllers.get(editor);
  if (!controller) {
    controller = new DeferController(editor);
    controllers.set(editor, controller);
  }
  return controller;
};

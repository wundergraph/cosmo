import { computeFieldPills } from './defer-pills';
import { QueryEditor, renderPills } from './defer-pills-render';
import { getOperation, parseQuery } from './operation';

type AnalysisState = {
  latencies: Record<string, number> | null;
  probeFailures: Record<string, string>;
  error: string | null;
  running: boolean;
};

const initialAnalysis: AnalysisState = { latencies: null, probeFailures: {}, error: null, running: false };

// Lives outside React so the editor's change listener and the pill markers can reach it directly.
// The editor only exists while GraphiQL is mounted, so the pills component binds it in an effect.
export class DeferStore {
  private state: AnalysisState = initialAnalysis;

  private editor: QueryEditor | undefined;
  private clearPills: (() => void) | undefined;
  private frame: number | undefined;
  private writing = false;
  private analysedUrl: string | undefined;
  private readonly listeners = new Set<() => void>();

  private readonly onChange = () => this.onEditorChange();

  // Returns the function that detaches the store from the editor.
  bind(editor: QueryEditor): () => void {
    this.editor = editor;
    editor.on('change', this.onChange);
    this.render();
    return () => {
      editor.off('change', this.onChange);
      if (this.frame !== undefined) {
        cancelAnimationFrame(this.frame);
        this.frame = undefined;
      }
      this.clearPills?.();
      this.clearPills = undefined;
      this.editor = undefined;
    };
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
    if (!this.editor) {
      return;
    }
    this.writing = true;
    try {
      this.editor.setValue(text);
    } finally {
      this.writing = false;
    }
  }

  startAnalysis(routingUrl: string, variablesError: string | null) {
    this.analysedUrl = routingUrl;
    this.update({ running: true, error: variablesError });
  }

  // Numbers measured against another endpoint would recommend the wrong defers, so they go.
  invalidateIfUrlChanged(routingUrl: string) {
    if (this.analysedUrl === undefined || this.analysedUrl === routingUrl) {
      return;
    }
    this.analysedUrl = undefined;
    this.clear();
  }

  finishAnalysis(latencies: Record<string, number>, probeFailures: Record<string, string>) {
    this.update({ latencies, probeFailures, running: false });
  }

  failAnalysis(message: string) {
    this.update({ latencies: null, error: message, running: false });
  }

  setRunning(running: boolean) {
    if (this.state.running === running) {
      return;
    }
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
    if (!this.writing) {
      if (this.state.latencies !== null || this.state.error !== null) {
        this.clear();
      }
      return;
    }
    if (this.state.latencies === null) {
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
    const editor = this.editor;
    if (!latencies || !editor) {
      return;
    }
    const text = editor.getValue();
    const operation = getOperation(parseQuery(text)?.doc)?.operation;
    if (operation !== undefined && operation !== 'query') {
      return;
    }

    try {
      this.clearPills = renderPills(editor, computeFieldPills(text, latencies));
    } catch {}
  }
}

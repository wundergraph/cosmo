import { computeFieldPills } from './defer-pills';
import { QueryEditor, renderPills } from './defer-pills-render';
import { measuredInputs } from './probe';
import { getOperation, parseQuery } from './operation';

const DEFER_ORIGIN = 'defer-advisor';

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
  private analysedUrl: string | undefined;
  private analysedInputs: string | undefined;
  private readonly listeners = new Set<() => void>();

  private readonly onChange = (_editor: unknown, change?: { origin?: string }) => this.onEditorChange(change?.origin);

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
    this.editor.getDoc().replaceRange(text, { line: 0, ch: 0 }, { line: Infinity, ch: Infinity }, DEFER_ORIGIN);
  }

  startAnalysis(routingUrl: string, variablesError: string | null, query: string) {
    this.analysedUrl = routingUrl;
    this.analysedInputs = measuredInputs(query);
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

  private onEditorChange(origin: string | undefined) {
    const hasAnalysis = this.state.latencies !== null;
    if (origin === DEFER_ORIGIN) {
      // A panel write moves @defer inside measured fields, so the baseline has to follow it.
      if (hasAnalysis) {
        this.analysedInputs = this.currentInputs();
        this.scheduleRender();
      }
      return;
    }
    if (hasAnalysis && !this.doesEditInvalidateAnalysis()) {
      this.scheduleRender();
      return;
    }
    // Clear the analysis if the query has changed sufficiently
    if (hasAnalysis || this.state.error !== null) {
      this.clear();
    }
  }

  private currentInputs() {
    return measuredInputs(this.editor?.getValue() ?? '');
  }

  private doesEditInvalidateAnalysis(): boolean {
    const current = this.currentInputs();
    return current === undefined || current !== this.analysedInputs;
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

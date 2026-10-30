import type { EditorContextType } from '@graphiql/react';
import { computeFieldPills } from './defer-pills';
import { QueryEditor, renderPills } from './defer-pills-render';
import { measuredInputs } from './probe';
import { getOperation, parseQuery } from './operation';

const DEFER_ORIGIN = 'defer-advisor';
const SET_VALUE_ORIGIN = 'setValue';

type AnalysisState = {
  latencies: Record<string, number> | null;
  probeFailures: Record<string, string>;
  error: string | null;
  running: boolean;
};

const initialAnalysis: AnalysisState = { latencies: null, probeFailures: {}, error: null, running: false };

type TabAnalysis = {
  state: AnalysisState;
  url: string | undefined;
  inputs: string | undefined;
};

type TextEditor = NonNullable<EditorContextType['variableEditor']>;
type Editors = { query: QueryEditor; variables?: TextEditor | null; headers?: TextEditor | null };

type EditEffect = 'rebaseline' | 'keep' | 'clear' | 'none';

// Lives outside React so the editor's change listener and the pill markers can reach it directly.
// The editor only exists while GraphiQL is mounted, so the pills component binds it in an effect.
export class DeferStore {
  private readonly tabs = new Map<string, TabAnalysis>();
  private activeTab = '';

  private editors: Editors | undefined;
  private clearPills: (() => void) | undefined;
  private frame: number | undefined;
  private readonly listeners = new Set<() => void>();

  private readonly onChange = (_editor: unknown, change?: { origin?: string }) => this.onEditorChange(change?.origin);

  // Returns the function that detaches the store from the editor.
  bind(editors: Editors): () => void {
    this.editors = editors;
    const bound = [editors.query, editors.variables, editors.headers].filter((editor) => editor != null);
    bound.forEach((editor) => editor.on('change', this.onChange));
    this.render();
    return () => {
      bound.forEach((editor) => editor.off('change', this.onChange));
      if (this.frame !== undefined) {
        cancelAnimationFrame(this.frame);
        this.frame = undefined;
      }
      this.clearPills?.();
      this.clearPills = undefined;
      this.editors = undefined;
    };
  }

  // Replaced on every change, so useSyncExternalStore sees a new reference exactly when something moved.
  get snapshot(): AnalysisState {
    return this.current.state;
  }

  setTabs(activeTab: string, openTabs: readonly string[]) {
    if (activeTab !== this.activeTab) {
      if (this.current.state.running) {
        this.current.state = { ...this.current.state, running: false };
      }
      this.activeTab = activeTab;
      this.revalidate();
      this.listeners.forEach((listener) => listener());
    }
    const open = new Set(openTabs);
    for (const tab of this.tabs.keys()) {
      if (!open.has(tab)) {
        this.tabs.delete(tab);
      }
    }
  }

  private get current(): TabAnalysis {
    let tab = this.tabs.get(this.activeTab);
    if (!tab) {
      tab = { state: initialAnalysis, url: undefined, inputs: undefined };
      this.tabs.set(this.activeTab, tab);
    }
    return tab;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  writeQuery(text: string) {
    if (!this.editors) {
      return;
    }
    this.editors.query.getDoc().replaceRange(text, { line: 0, ch: 0 }, { line: Infinity, ch: Infinity }, DEFER_ORIGIN);
  }

  startAnalysis(routingUrl: string, variablesError: string | null, query: string): string {
    this.current.url = routingUrl;
    this.current.inputs = this.requestInputs(query);
    this.update({ running: true, error: variablesError });
    return this.activeTab;
  }

  // Numbers measured against another endpoint would recommend the wrong defers, so they go.
  invalidateIfUrlChanged(routingUrl: string) {
    const tab = this.current;
    if (tab.url === undefined || tab.url === routingUrl) {
      return;
    }
    tab.url = undefined;
    this.clear();
  }

  finishAnalysis(latencies: Record<string, number>, probeFailures: Record<string, string>, tabId = this.activeTab) {
    this.update({ latencies, probeFailures, running: false }, tabId);
  }

  failAnalysis(message: string, tabId = this.activeTab) {
    this.update({ latencies: null, error: message, running: false }, tabId);
  }

  setRunning(running: boolean) {
    if (this.current.state.running === running) {
      return;
    }
    this.update({ running });
  }

  clear() {
    this.update({ latencies: null, probeFailures: {}, error: null });
  }

  private update(patch: Partial<AnalysisState>, tabId = this.activeTab) {
    const tab = tabId === this.activeTab ? this.current : this.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.state = { ...tab.state, ...patch };
    this.listeners.forEach((listener) => listener());
    if ('latencies' in patch) {
      this.render();
    }
  }

  private onEditorChange(origin: string | undefined) {
    switch (this.determineEditEffect(origin)) {
      case 'rebaseline':
        this.current.inputs = this.currentInputs();
        this.scheduleRender();
        break;
      case 'keep':
        this.scheduleRender();
        break;
      case 'clear':
        this.clear();
        break;
      case 'none':
        break;
    }
  }

  private determineEditEffect(origin: string | undefined): EditEffect {
    const { latencies, error } = this.current.state;
    if (origin === SET_VALUE_ORIGIN) {
      return latencies === null ? 'none' : 'keep';
    }
    // With no latencies there is nothing to keep, but a user edit may have fixed whatever caused the error.
    if (latencies === null) {
      return origin !== DEFER_ORIGIN && error !== null ? 'clear' : 'none';
    }
    // The panel moves @defer inside measured fields, so the baseline has to follow it.
    if (origin === DEFER_ORIGIN) {
      return 'rebaseline';
    }
    return this.doesEditInvalidateAnalysis() ? 'clear' : 'keep';
  }

  private requestInputs(query: string) {
    const measured = measuredInputs(query);
    if (measured === undefined) {
      return undefined;
    }
    return [measured, this.editors?.variables?.getValue() ?? '', this.editors?.headers?.getValue() ?? ''].join('\n\n');
  }

  private currentInputs() {
    return this.requestInputs(this.editors?.query.getValue() ?? '');
  }

  private doesEditInvalidateAnalysis(): boolean {
    const current = this.currentInputs();
    return current === undefined || current !== this.current.inputs;
  }

  private revalidate() {
    if (this.current.state.latencies !== null && this.doesEditInvalidateAnalysis()) {
      this.clear();
      return;
    }
    this.render();
  }

  private scheduleRender() {
    if (this.frame !== undefined) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.revalidate();
    });
  }

  private render() {
    this.clearPills?.();
    this.clearPills = undefined;

    const { latencies } = this.current.state;
    const editor = this.editors?.query;
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

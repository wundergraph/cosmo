import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  CheckOperationUsageStats,
  CompositionError,
  GraphPruningIssue,
  LintIssue,
  SchemaChange,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export type JsonOutputDescriptor = {
  status: 'error' | 'success';
  code: EnumStatusCode;
  details?: string;
  message?: string;
  url?: string;
  proposals?: {
    success: boolean;
    message: string;
  };
  traffic?: {
    success: boolean;
    isLinkedToTargetSubgraph: boolean;
    message: string;
  };
  changes?: {
    breaking: SchemaChange[];
    nonBreaking: SchemaChange[];
  };
  composition?: {
    success: boolean;
    errors: CompositionError[];
    warnings: CompositionError[];
  };
  lint?: {
    success: boolean;
    errors: LintIssue[];
    warnings: LintIssue[];
  };
  graphPrune?: {
    success: boolean;
    isLinkedToTargetSubgraph: boolean;
    errors: GraphPruningIssue[];
    warnings: GraphPruningIssue[];
  };
  extensions?: {
    success: boolean;
    message: string;
  };
  exceededRowLimit?: boolean;
  rowLimit: number;
  operationUsageStats?: CheckOperationUsageStats;
};

export class JsonOutputBuilder {
  private readonly data: JsonOutputDescriptor;
  private readonly outFile?: string;

  constructor(code: EnumStatusCode, rowLimit: number, outFile?: string) {
    this.data = { status: 'error', code, rowLimit };
    this.outFile = outFile;
  }

  setUrl(url: string): this {
    this.data.url = url;
    return this;
  }

  setCode(code: EnumStatusCode): this {
    this.data.code = code;
    return this;
  }

  setStatus(success: boolean): this {
    this.data.status = success ? 'success' : 'error';
    return this;
  }

  setMessage(message: string): this {
    this.data.message = message;
    return this;
  }

  setDetails(details: string | undefined): this {
    this.data.details = details;
    return this;
  }

  setProposals(success: boolean, message: string): this {
    this.data.proposals = { success, message };
    return this;
  }

  initProposals(success: boolean, message: string): this {
    this.data.proposals ??= { success, message };
    return this;
  }

  setTraffic(success: boolean, isLinkedToTargetSubgraph: boolean, message: string): this {
    this.data.traffic = { success, isLinkedToTargetSubgraph, message };
    return this;
  }

  markTrafficLinkedFailed(isLinked: boolean, fallbackMessage: string): this {
    this.data.traffic = {
      ...this.data.traffic,
      success: false,
      isLinkedToTargetSubgraph: isLinked,
      message: this.data.traffic?.message ?? fallbackMessage,
    };
    return this;
  }

  addBreakingChanges(changes: SchemaChange[]): this {
    this.data.changes = {
      ...this.data.changes,
      breaking: [...(this.data.changes?.breaking ?? []), ...changes],
      nonBreaking: [...(this.data.changes?.nonBreaking ?? [])],
    };
    return this;
  }

  addNonBreakingChanges(changes: SchemaChange[]): this {
    this.data.changes = {
      breaking: [...(this.data.changes?.breaking ?? [])],
      nonBreaking: [...(this.data.changes?.nonBreaking ?? []), ...changes],
    };
    return this;
  }

  setOperationUsageStats(stats: CheckOperationUsageStats): this {
    this.data.operationUsageStats ??= stats;
    return this;
  }

  addCompositionErrors(errors: CompositionError[]): this {
    this.data.composition = {
      ...this.data.composition,
      success: false,
      errors: [...(this.data.composition?.errors ?? []), ...errors],
      warnings: [...(this.data.composition?.warnings ?? [])],
    };
    return this;
  }

  addCompositionWarnings(warnings: CompositionError[]): this {
    this.data.composition = {
      ...this.data.composition,
      success: false,
      errors: [...(this.data.composition?.errors ?? [])],
      warnings: [...(this.data.composition?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addLintErrors(errors: LintIssue[]): this {
    this.data.lint = {
      ...this.data.lint,
      success: false,
      errors: [...(this.data.lint?.errors ?? []), ...errors],
      warnings: [...(this.data.lint?.warnings ?? [])],
    };
    return this;
  }

  addLintWarnings(warnings: LintIssue[]): this {
    this.data.lint = {
      ...this.data.lint,
      success: false,
      errors: [...(this.data.lint?.errors ?? [])],
      warnings: [...(this.data.lint?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addGraphPruneErrors(errors: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: this.data.graphPrune?.isLinkedToTargetSubgraph ?? false,
      errors: [...(this.data.graphPrune?.errors ?? []), ...errors],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  addGraphPruneWarnings(warnings: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: this.data.graphPrune?.isLinkedToTargetSubgraph ?? false,
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? []), ...warnings],
    };
    return this;
  }

  markGraphPruneLinkedFailed(isLinked: boolean): this {
    this.data.graphPrune = {
      ...this.data.graphPrune,
      success: false,
      isLinkedToTargetSubgraph: isLinked,
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  setExtensionError(message: string): this {
    this.data.extensions = { ...this.data.extensions, success: false, message };
    return this;
  }

  setExceededRowLimit(exceeded: boolean): this {
    this.data.exceededRowLimit = exceeded;
    return this;
  }

  build(): JsonOutputDescriptor {
    return this.data;
  }

  async write(): Promise<void> {
    const output = this.build();

    if (this.outFile) {
      await writeFile(this.outFile, JSON.stringify(output, null, 2));
    } else {
      console.log(output);
    }
  }
}

import { writeFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  CheckOperationUsageStats,
  CompositionError,
  FederatedGraphSchemaChange,
  GraphPruningIssue,
  LintIssue,
  SchemaChange,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

export type JsonCheckSchemaOutputDescriptor = {
  status: 'error' | 'success';
  code: EnumStatusCode;
  details?: string;
  message?: string;
  url?: string;
  proposals?: {
    message: string;
  };
  traffic?: {
    message: string;
  };
  changes?: {
    breaking: SchemaChange[];
    nonBreaking: SchemaChange[];
  };
  composition?: {
    errors: CompositionError[];
    warnings: CompositionError[];
  };
  lint?: {
    errors: LintIssue[];
    warnings: LintIssue[];
  };
  graphPrune?: {
    errors: GraphPruningIssue[];
    warnings: GraphPruningIssue[];
  };
  composedSchemaBreakingChanges?: FederatedGraphSchemaChange[];
  extensions?: {
    message: string;
  };
  exceededRowLimit?: boolean;
  rowLimit: number;
  operationUsageStats?: CheckOperationUsageStats;
};

export class JsonCheckSchemaOutputBuilder {
  private readonly data: JsonCheckSchemaOutputDescriptor;
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

  setProposals(message: string): this {
    this.data.proposals = { message };
    return this;
  }

  initProposals(message: string): this {
    this.data.proposals ??= { message };
    return this;
  }

  setTraffic(message: string): this {
    this.data.traffic = { message };
    return this;
  }

  markTrafficLinkedFailed(fallbackMessage: string): this {
    this.data.traffic = {
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
      errors: [...(this.data.composition?.errors ?? []), ...errors],
      warnings: [...(this.data.composition?.warnings ?? [])],
    };
    return this;
  }

  addCompositionWarnings(warnings: CompositionError[]): this {
    this.data.composition = {
      errors: [...(this.data.composition?.errors ?? [])],
      warnings: [...(this.data.composition?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addLintErrors(errors: LintIssue[]): this {
    this.data.lint = {
      errors: [...(this.data.lint?.errors ?? []), ...errors],
      warnings: [...(this.data.lint?.warnings ?? [])],
    };
    return this;
  }

  addLintWarnings(warnings: LintIssue[]): this {
    this.data.lint = {
      errors: [...(this.data.lint?.errors ?? [])],
      warnings: [...(this.data.lint?.warnings ?? []), ...warnings],
    };
    return this;
  }

  addGraphPruneErrors(errors: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      errors: [...(this.data.graphPrune?.errors ?? []), ...errors],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  addGraphPruneWarnings(warnings: GraphPruningIssue[]): this {
    this.data.graphPrune = {
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? []), ...warnings],
    };
    return this;
  }

  markGraphPruneLinkedFailed(): this {
    this.data.graphPrune = {
      errors: [...(this.data.graphPrune?.errors ?? [])],
      warnings: [...(this.data.graphPrune?.warnings ?? [])],
    };
    return this;
  }

  addComposedSchemaBreakingChanges(changes: FederatedGraphSchemaChange[]): this {
    this.data.composedSchemaBreakingChanges = [...(this.data.composedSchemaBreakingChanges ?? []), ...changes];
    return this;
  }

  setExtensionError(message: string): this {
    this.data.extensions = { message };
    return this;
  }

  setExceededRowLimit(exceeded: boolean): this {
    this.data.exceededRowLimit = exceeded;
    return this;
  }

  build(): JsonCheckSchemaOutputDescriptor {
    return this.data;
  }

  /**
   * Writes valid JSON either to stdout or a file.
   */
  async write(): Promise<void> {
    if (this.outFile) {
      await writeFile(this.outFile, this.serializeOutput(true));
    } else {
      console.log(this.serializeOutput());
    }
  }

  private serializeOutput(formatted = false): string {
    try {
      return JSON.stringify(this.build(), null, formatted ? 2 : 0);
    } catch (err) {
      console.error('Failed to serialize JSON data.');
      throw err;
    }
  }
}

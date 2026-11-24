export type Severity = 'error' | 'warn';

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/** One violation of a design rule, with what an agent needs to repair it. */
export interface Finding {
  rule: string;
  severity: Severity;
  /** The schema coordinate, such as `Query.returns` or `Color.RED`. */
  coordinate: string;
  message: string;
  location?: SourceLocation;
  found?: string;
  expected?: string;
  /** A field elsewhere in the graph that follows the rule. */
  reference?: { coordinate: string; file: string };
}

/** A finding the team has approved in wundergraph.yaml, reported apart from the open ones. */
export interface ExceptedFinding extends Finding {
  reason: string;
}

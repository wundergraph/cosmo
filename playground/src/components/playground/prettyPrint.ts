import { QueryPlanFetchNode, QueryPlanFetchTypeNode, Representation } from './types';

export class PlanPrinter {
  depth: number = 0;
  buf: string[] = [];

  print(plan: QueryPlanFetchTypeNode): string {
    this.buf = [];
    this.printText('QueryPlan {');
    this.printPlanNode(plan, true);
    this.printText('}');
    return this.buf.join('\n');
  }

  private printPlanNode(plan: QueryPlanFetchTypeNode, increaseDepth: boolean) {
    if (increaseDepth) {
      this.depth++;
    }

    switch (plan.kind) {
      case 'Single':
        this.printFetchInfo(plan.fetch!);
        break;
      case 'Sequence':
        const manyChildren = (plan.children?.length || 0) > 1;
        if (manyChildren) {
          this.printText('Sequence {');
        }
        plan.children?.forEach((child) => this.printPlanNode(child, manyChildren));
        if (manyChildren) {
          this.printText('}');
        }
        break;
      case 'Parallel':
        this.printText('Parallel {');
        plan.children?.forEach((child) => this.printPlanNode(child, true));
        this.printText('}');
        break;
    }

    if (increaseDepth) {
      this.depth--;
    }
  }

  private printFetchInfo(fetch: QueryPlanFetchNode) {
    const nested = fetch.path?.includes('.');

    if (nested) {
      this.printText(`Flatten(path: "${fetch.path}") {`);
      this.depth++;
    }

    this.printText(`${fetch.kind}Fetch(service: "${fetch.subgraphName}") {`);
    this.depth++;

    if (fetch.representations) {
      this.printRepresentations(fetch.representations);
    }
    this.printQuery(fetch.query);

    this.depth--;
    this.printText('}');

    if (nested) {
      this.depth--;
      this.printText('}');
    }
  }

  private printQuery(query: string) {
    const lines = query.split('\n');
    lines[0] = '{';
    lines[lines.length - 1] = '}';
    this.printText(...lines);
  }

  private printRepresentations(reps: Representation[]) {
    this.printText('{');
    this.depth++;
    reps.forEach((rep) => {
      const lines = rep.fragment.split('\n');
      this.printText(...lines);
    });
    this.depth--;
    this.printText('} =>');
  }

  private printText(...lines: string[]) {
    lines.forEach((line) => {
      this.buf.push(`${'    '.repeat(this.depth)}${line}`);
    });
  }
}

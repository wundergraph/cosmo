import { parse, print } from "graphql";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import {
  QueryPlan,
  QueryPlanFetchNode,
  QueryPlanFetchTypeNode,
  Representation,
} from "./types";

export class PlanPrinter {
  private depth: number = 0;
  private buf: string[] = [];

  async print(plan: QueryPlan): Promise<string> {
    this.buf = [];
    this.printText("QueryPlan {");
    if (plan.trigger) {
      this.depth++;
      await this.printFetchInfo(plan.trigger);
      this.depth--;
    }
    await this.printPlanNode(plan, true);
    this.printText("}");
    return this.buf.join("\n");
  }

  private async printPlanNode(
    plan: QueryPlanFetchTypeNode,
    increaseDepth: boolean,
  ) {
    if (increaseDepth) {
      this.depth++;
    }

    switch (plan.kind) {
      case "Single":
      case "Trigger":
        await this.printFetchInfo(plan.fetch!);
        break;
      case "Sequence":
        const manyChildren = (plan.children?.length || 0) > 1;
        if (manyChildren) {
          this.printText("Sequence {");
        }
        for (const child of plan.children ?? []) {
          await this.printPlanNode(child, manyChildren);
        }
        if (manyChildren) {
          this.printText("}");
        }
        break;
      case "Parallel":
        this.printText("Parallel {");
        for (const child of plan.children ?? []) {
          await this.printPlanNode(child, true);
        }
        this.printText("}");
        break;
    }

    if (increaseDepth) {
      this.depth--;
    }
  }

  private async printFetchInfo(fetch: QueryPlanFetchNode) {
    const nested = fetch.path?.includes(".");

    if (nested) {
      this.printText(`Flatten(path: "${fetch.path}") {`);
      this.depth++;
    }

    let suffix = "Fetch";
    if (fetch.kind === "Trigger") {
      suffix = "";
    }

    this.printText(
      `${fetch.kind}${suffix}(service: "${fetch.subgraphName}") {`,
    );
    this.depth++;

    if (fetch.representations) {
      this.printRepresentations(fetch.representations);
    }

    if (fetch.query) {
      const query = print(parse(fetch.query));
      const formatted = await prettier.format(query, {
        parser: "graphql",
        plugins: [graphQLPlugin],
        printWidth: 80,
        tabWidth: 4,
        useTabs: false,
      });
      this.printQuery(formatted.trim());
    }

    this.depth--;
    this.printText("}");

    if (nested) {
      this.depth--;
      this.printText("}");
    }
  }

  private printQuery(query: string) {
    const lines = query.split("\n");
    lines[0] = "{";
    lines[lines.length - 1] = "}";
    this.printText(...lines);
  }

  private printRepresentations(reps: Representation[]) {
    this.printText("{");
    this.depth++;
    reps.forEach((rep) => {
      const lines = rep.fragment.split("\n");
      this.printText(...lines);
    });
    this.depth--;
    this.printText("} =>");
  }

  private printText(...lines: string[]) {
    lines.forEach((line) => {
      this.buf.push(`${"    ".repeat(this.depth)}${line}`);
    });
  }
}

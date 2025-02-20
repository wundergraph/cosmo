export type WarningSubgraphData = {
  name: string;
};
export type WarningOptions = {
  message: string;
  subgraph: WarningSubgraphData;
};

export class Warning extends Error {
  subgraph: WarningSubgraphData;

  constructor(options: WarningOptions) {
    super(options.message);
    this.name = 'Warning';
    this.subgraph = options.subgraph;
  }
}

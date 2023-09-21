import { ArgumentConfigurationData } from '@wundergraph/composition';

type Subgraph = {
    schema: string;
    name: string;
    url: string;
};
type FederatedGraph = {
    argumentConfigurations: ArgumentConfigurationData[];
    ast: string;
    schema: string;
};
declare function federateSubgraphs(subgraphs: Subgraph[]): FederatedGraph;

export { FederatedGraph, Subgraph, federateSubgraphs };

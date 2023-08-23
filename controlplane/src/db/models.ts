import { InferModel } from 'drizzle-orm';
import { federatedGraphs, subgraphs, targets } from './schema.js';

export type FederatedGraph = InferModel<typeof federatedGraphs>; // return type when queried
export type NewFederatedGraph = InferModel<typeof federatedGraphs, 'insert'>; // insert type

export type Subgraph = InferModel<typeof subgraphs>;
export type NewSubgraph = InferModel<typeof subgraphs, 'insert'>;

export type Target = InferModel<typeof targets>;
export type NewTarget = InferModel<typeof targets, 'insert'>;

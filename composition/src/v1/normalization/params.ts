import type { DirectiveName, FieldName, SubgraphName } from '../../types/types';
import type { CompositeOutputData, InputObjectDefinitionData } from '../../schema-building/types';
import type { ConstDirectiveNode } from 'graphql';
import { Subgraph } from '../../subgraph/types';
import { CompositionOptions } from '../../types/params';
import { Graph } from '../../resolvability-graph/graph';
import { DocumentNode } from 'graphql/index';

export type ValidateOneOfDirectiveParams = {
  data: InputObjectDefinitionData;
  requiredFieldNames: Set<FieldName>;
};

export type HandleFieldInheritableDirectivesParams = {
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>;
  fieldName: FieldName;
  inheritedDirectiveNames: Set<DirectiveName>;
  parentData: CompositeOutputData;
};

export type HandleNonExternalConditionalFieldParams = {
  currentFieldCoords: string;
  directiveCoords: string;
  directiveName: DirectiveName;
  fieldSet: string;
};

export type BatchNormalizeParams = {
  subgraphs: Array<Subgraph>;
  options?: CompositionOptions;
};

export type NormalizationFactoryParams = {
  internalGraph: Graph;
  options?: CompositionOptions;
  subgraphName?: SubgraphName;
};

export type NormalizeSubgraphParams = {
  document: DocumentNode;
  internalGraph?: Graph;
  options?: CompositionOptions;
  subgraphName?: SubgraphName;
};

export type NormalizeSubgraphFromStringParams = {
  noLocation: boolean;
  sdlString: string;
  options?: CompositionOptions;
};

import type { DirectiveName, FieldName, SubgraphName } from '../../types/types';
import type { CompositeOutputData, InputObjectDefinitionData } from '../../schema-building/types';
import type { ConstDirectiveNode, DocumentNode } from 'graphql';
import type { Subgraph } from '../../subgraph/types';
import type { CompositionOptions } from '../../types/params';
import type { Graph } from '../../resolvability-graph/graph';

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

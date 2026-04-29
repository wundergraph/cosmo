import { type DirectiveArgumentDataParams, type DirectiveDefinitionDataParams } from './types/params';
import { type ConfigureDescriptionData } from '../schema-building/types/types';
import { type ArgumentName, type DirectiveName, type SubgraphName } from '../types/types';
import { EXECUTABLE_DIRECTIVE_LOCATIONS } from '../utils/string-constants';
import { type ConstDirectiveNode, Kind } from 'graphql';
import { newFederatedDirectivesData } from '../schema-building/utils';
import { getTypeNodeNamedTypeName } from '../schema-building/ast';
import { stringToNameNode } from '../ast/utils';
import { type DirectiveArgumentData, type DirectiveDefinitionData } from './types/types';

export function newDirectiveArgumentData({
  configureDescriptionDataBySubgraphName,
  directive,
  defaultValue,
  description,
  directivesByName,
  name,
  namedTypeKind,
  node,
  requiredSubgraphNames,
  subgraphNames,
  typeNode,
}: DirectiveArgumentDataParams): DirectiveArgumentData {
  return {
    configureDescriptionDataBySubgraphName:
      configureDescriptionDataBySubgraphName ?? new Map<SubgraphName, ConfigureDescriptionData>(),
    directivesByName: directivesByName ?? new Map<DirectiveName, Array<ConstDirectiveNode>>(),
    federatedCoords: directive,
    federatedDirectivesData: newFederatedDirectivesData(),
    includeDefaultValue: !!defaultValue,
    kind: Kind.ARGUMENT,
    name,
    namedTypeKind,
    namedTypeName: getTypeNodeNamedTypeName(typeNode),
    node: node ?? {
      directives: [],
      defaultValue,
      description,
      name: stringToNameNode(name),
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: typeNode,
    },
    originalCoords: directive,
    requiredSubgraphNames: requiredSubgraphNames ?? new Set<SubgraphName>(),
    subgraphNames: subgraphNames ?? new Set<SubgraphName>(),
    type: typeNode,
    defaultValue,
    description,
  };
}

export function newDirectiveDefinitionData({
  argumentDataByName,
  description,
  isComposed,
  isReferenced,
  isRepeatable,
  locations,
  name,
  node,
  optionalArgumentNames,
  requiredArgumentNames,
  subgraphNames,
}: DirectiveDefinitionDataParams): DirectiveDefinitionData {
  return {
    argumentDataByName: argumentDataByName ?? new Map<ArgumentName, DirectiveArgumentData>(),
    description,
    executableLocations: locations.intersection(EXECUTABLE_DIRECTIVE_LOCATIONS),
    isComposed: !!isComposed,
    isReferenced: !!isReferenced,
    isRepeatable: !!isRepeatable,
    locations,
    name,
    optionalArgumentNames: optionalArgumentNames ?? new Set<ArgumentName>(),
    node,
    requiredArgumentNames: requiredArgumentNames ?? new Set<ArgumentName>(),
    subgraphNames: subgraphNames ?? new Set<SubgraphName>(),
    version: -1,
  };
}

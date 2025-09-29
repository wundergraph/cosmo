import { unresolvablePathError } from '../../errors/errors';
import { LITERAL_SPACE, QUOTATION_JOIN } from '../../utils/string-constants';
import { getOrThrowError } from '../../utils/utils';
import { GraphFieldData } from '../../utils/types';
import { NodeResolutionData } from '../node-resolution-data/node-resolution-data';
import { FieldName, RootFieldData, SelectionPath, SubgraphName, TypeName } from '../types/types';

import {
  GetMultipliedRelativeOriginPathsParams,
  ResolvabilityErrorsParams,
  RootResolvabilityErrorsParams,
} from './types/params';
import { EntityAncestorData } from './types/types';

export type EntityResolvabilitySuccess = {
  success: true;
};

export type EntityResolvabilityFailure = {
  entityAncestorData: EntityAncestorData;
  nodeName: string;
  parentFieldPathForEntityReference: Array<string>;
  success: false;
  typeName: string;
  unresolvableFieldPaths: Set<string>;
};

export type EntityResolvabilityResult = EntityResolvabilitySuccess | EntityResolvabilityFailure;

export type UnresolvableFieldData = {
  fieldName: string;
  selectionSet: string;
  subgraphNames: Set<string>;
  typeName: string;
};

export function newRootFieldData(
  typeName: TypeName,
  fieldName: FieldName,
  subgraphNames: Set<SubgraphName>,
): RootFieldData {
  return {
    coords: `${typeName}.${fieldName}`,
    message:
      `The root type field "${typeName}.${fieldName}" is defined in the following subgraph` +
      (subgraphNames.size > 1 ? `s` : ``) +
      `: "${[...subgraphNames].join(QUOTATION_JOIN)}".`,
    subgraphNames,
  };
}

type ResolvabilityErrorsOptions = {
  errors: Array<Error>;
  nodeResolutionDataByFieldPath: Map<string, NodeResolutionData>;
  rootFieldData: RootFieldData;
  unresolvableFieldPaths: Array<string> | Set<string>;
  entityAncestorData?: EntityAncestorData;
  pathFromRoot?: string;
};

function formatFieldNameSelection(fieldData: GraphFieldData, pathLength: number): string {
  if (fieldData.isLeaf) {
    return fieldData.name + ` <--\n`;
  }
  return (
    fieldData.name +
    ` { <--\n` +
    LITERAL_SPACE.repeat(pathLength + 3) +
    `...\n` +
    LITERAL_SPACE.repeat(pathLength + 2) +
    `}\n`
  );
}

export type GenerateResolvabilityErrorReasonsOptions = {
  rootFieldData: RootFieldData;
  unresolvableFieldData: UnresolvableFieldData;
  entityAncestorData?: EntityAncestorData;
};

export function generateResolvabilityErrorReasons({
  entityAncestorData,
  rootFieldData,
  unresolvableFieldData,
}: GenerateResolvabilityErrorReasonsOptions): Array<string> {
  const { fieldName, typeName, subgraphNames } = unresolvableFieldData;
  const reasons: Array<string> = [
    rootFieldData.message,
    `The field "${typeName}.${fieldName}" is defined in the following subgraph` +
      (subgraphNames.size > 1 ? `s` : ``) +
      `: "${[...subgraphNames].join(QUOTATION_JOIN)}".`,
  ];
  if (entityAncestorData) {
    let hasIntersectingTargetSubgraph = false;
    for (const [targetSubgraphName, fieldSets] of entityAncestorData.fieldSetsByTargetSubgraphName) {
      if (!subgraphNames.has(targetSubgraphName)) {
        continue;
      }
      hasIntersectingTargetSubgraph = true;
      for (const fieldSet of fieldSets) {
        reasons.push(
          `The entity ancestor "${entityAncestorData.typeName}" in subgraph "${entityAncestorData.subgraphName}" does not satisfy the key field set "${fieldSet}" to access subgraph "${targetSubgraphName}".`,
        );
      }
    }
    if (!hasIntersectingTargetSubgraph) {
      reasons.push(
        `The entity ancestor "${entityAncestorData.typeName}" in subgraph "${entityAncestorData.subgraphName}" has no accessible target entities (resolvable @key directives) in the subgraphs where "${typeName}.${fieldName}" is defined.`,
      );
    }
    reasons.push(
      `The type "${typeName}" is not a descendant of any other entity ancestors that can provide a shared route to access "${fieldName}".`,
    );
  } else {
    if (rootFieldData.subgraphNames.size > 1) {
      reasons.push(
        `None of the subgraphs that shares the same root type field "${rootFieldData.coords}" can provide a route to access "${fieldName}".`,
      );
    }
    reasons.push(
      `The type "${typeName}" is not a descendant of an entity ancestor that can provide a shared route to access "${fieldName}".`,
    );
  }
  if (typeName !== entityAncestorData?.typeName) {
    reasons.push(
      `The type "${typeName}" has no accessible target entities (resolvable @key directives) in any other subgraph, so accessing other subgraphs is not possible.`,
    );
  }
  return reasons;
}

type SelectionSetSegments = {
  outputEnd: string;
  outputStart: string;
  pathNodes: Array<string>;
};

export function generateSelectionSetSegments(fieldPath: string): SelectionSetSegments {
  // Regex is to split on singular periods and not fragments (... on TypeName)
  const pathNodes = fieldPath.split(/(?<=\w)\./);
  let outputStart = '';
  let outputEnd = '';
  for (let i = 0; i < pathNodes.length; i++) {
    outputStart += LITERAL_SPACE.repeat(i + 1) + pathNodes[i] + ` {\n`;
    outputEnd = LITERAL_SPACE.repeat(i + 1) + `}\n` + outputEnd;
  }
  return {
    outputEnd,
    outputStart,
    pathNodes,
  };
}

export function renderSelectionSet(
  { outputEnd, outputStart, pathNodes }: SelectionSetSegments,
  fieldData: GraphFieldData,
): string {
  return (
    outputStart +
    LITERAL_SPACE.repeat(pathNodes.length + 1) +
    formatFieldNameSelection(fieldData, pathNodes.length) +
    outputEnd
  );
}

function getUnresolvablePath(fieldPath: string, pathFromRoot?: string): string {
  if (pathFromRoot) {
    if (fieldPath) {
      return `${pathFromRoot}${fieldPath}`;
    }
    return pathFromRoot;
  }
  return fieldPath;
}

export function generateRootResolvabilityErrors({
  resDataByPath,
  rootFieldData,
  unresolvablePaths,
}: RootResolvabilityErrorsParams): Array<Error> {
  const unresolvableFieldDatas = new Array<UnresolvableFieldData>();
  for (const path of unresolvablePaths) {
    const nodeResolutionData = getOrThrowError(resDataByPath, path, 'resDataByPath');
    const fieldDataByFieldName = new Map<string, GraphFieldData>();
    for (const [fieldName, fieldData] of nodeResolutionData.fieldDataByName) {
      if (nodeResolutionData.resolvedFieldNames.has(fieldName)) {
        continue;
      }
      fieldDataByFieldName.set(fieldName, fieldData);
    }
    const selectionSetSegments = generateSelectionSetSegments(path);
    for (const [fieldName, fieldData] of fieldDataByFieldName) {
      unresolvableFieldDatas.push({
        fieldName,
        selectionSet: renderSelectionSet(selectionSetSegments, fieldData),
        subgraphNames: fieldData.subgraphNames,
        typeName: nodeResolutionData.typeName,
      });
    }
  }
  const errors = new Array<Error>();
  for (const unresolvableFieldData of unresolvableFieldDatas) {
    errors.push(
      unresolvablePathError(
        unresolvableFieldData,
        generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData }),
      ),
    );
  }
  return errors;
}

export function generateResolvabilityErrors({
  entityAncestorData,
  resDataByPath,
  pathFromRoot,
  rootFieldData,
  subgraphNameByUnresolvablePath,
}: ResolvabilityErrorsParams): Array<Error> {
  const errors = new Array<Error>();
  for (const [path, subgraphName] of subgraphNameByUnresolvablePath) {
    const unresolvableFieldDatas = new Array<UnresolvableFieldData>();
    const nodeResolutionData = getOrThrowError(resDataByPath, path, 'resDataByPath');
    const fieldDataByFieldName = new Map<string, GraphFieldData>();
    for (const [fieldName, fieldData] of nodeResolutionData.fieldDataByName) {
      if (nodeResolutionData.resolvedFieldNames.has(fieldName)) {
        continue;
      }
      fieldDataByFieldName.set(fieldName, fieldData);
    }
    const fullPath = getUnresolvablePath(path, pathFromRoot);
    const selectionSetSegments = generateSelectionSetSegments(fullPath);
    for (const [fieldName, fieldData] of fieldDataByFieldName) {
      unresolvableFieldDatas.push({
        fieldName,
        selectionSet: renderSelectionSet(selectionSetSegments, fieldData),
        subgraphNames: fieldData.subgraphNames,
        typeName: nodeResolutionData.typeName,
      });
    }
    // Reflect whence the resolvability came accurately.
    entityAncestorData.subgraphName = subgraphName;
    for (const unresolvableFieldData of unresolvableFieldDatas) {
      errors.push(
        unresolvablePathError(
          unresolvableFieldData,
          generateResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData, entityAncestorData }),
        ),
      );
    }
  }
  return errors;
}

export function getMultipliedRelativeOriginPaths({
  relativeOriginPaths,
  selectionPath,
}: GetMultipliedRelativeOriginPathsParams): Set<SelectionPath> {
  if (!relativeOriginPaths) {
    return new Set<SelectionPath>([selectionPath]);
  }
  const multipliedPaths = new Set<SelectionPath>();
  for (const originPath of relativeOriginPaths) {
    multipliedPaths.add(`${originPath}${selectionPath}`);
  }
  return multipliedPaths;
}

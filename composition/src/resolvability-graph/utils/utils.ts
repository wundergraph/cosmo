import { unresolvablePathError } from '../../errors/errors';
import { getOrThrowError } from '../../utils/utils';
import { GraphFieldData } from '../../utils/types';
import { FieldName, RootFieldData, SelectionPath, SubgraphName, TypeName } from '../types/types';

import {
  GenerateResolvabilityErrorReasonsParams,
  GenerateSharedResolvabilityErrorReasonsParams,
  GetMultipliedRelativeOriginPathsParams,
  ResolvabilityErrorsParams,
  RootResolvabilityErrorsParams,
  SharedResolvabilityErrorsParams,
} from './types/params';
import { SelectionSetSegments } from './types/types';
import { LITERAL_SPACE, QUOTATION_JOIN } from '../constants/string-constants';

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

export function generateResolvabilityErrorReasons({
  entityAncestorData,
  rootFieldData,
  unresolvableFieldData,
}: GenerateResolvabilityErrorReasonsParams): Array<string> {
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

export function generateSharedResolvabilityErrorReasons({
  entityAncestors,
  rootFieldData,
  unresolvableFieldData,
}: GenerateSharedResolvabilityErrorReasonsParams): Array<string> {
  const { fieldName, typeName, subgraphNames } = unresolvableFieldData;
  const reasons: Array<string> = [
    rootFieldData.message,
    `The field "${typeName}.${fieldName}" is defined in the following subgraph` +
      (subgraphNames.size > 1 ? `s` : ``) +
      `: "${[...subgraphNames].join(QUOTATION_JOIN)}".`,
  ];
  let hasIntersectingTargetSubgraph = false;
  for (const [targetSubgraphName, fieldSets] of entityAncestors.fieldSetsByTargetSubgraphName) {
    if (!subgraphNames.has(targetSubgraphName)) {
      continue;
    }
    const filteredSubgraphNames = entityAncestors.subgraphNames.filter(
      (subgraphName) => subgraphName !== targetSubgraphName,
    );
    const isSubsetPlural = filteredSubgraphNames.length > 1;
    hasIntersectingTargetSubgraph = true;
    for (const fieldSet of fieldSets) {
      reasons.push(
        `The entity ancestor "${entityAncestors.typeName}" in subgraph${isSubsetPlural ? `s` : ``}` +
          ` "${filteredSubgraphNames.join(QUOTATION_JOIN)}" do${isSubsetPlural ? `` : `es`} not satisfy` +
          ` the key field set "${fieldSet}" to access subgraph "${targetSubgraphName}".`,
      );
    }
  }
  if (!hasIntersectingTargetSubgraph) {
    const isPlural = entityAncestors.subgraphNames.length > 1;
    reasons.push(
      `The entity ancestor "${entityAncestors.typeName}" in subgraph${isPlural ? `s` : ``}` +
        ` "${entityAncestors.subgraphNames.join(QUOTATION_JOIN)}" ha${isPlural ? `ve` : `s`} no accessible target` +
        ` entities (resolvable @key directives) in the subgraphs where "${typeName}.${fieldName}" is defined.`,
    );
  }
  reasons.push(
    `The type "${typeName}" is not a descendant of any other entity ancestors that can provide a shared route to access "${fieldName}".`,
  );
  if (typeName !== entityAncestors?.typeName) {
    reasons.push(
      `The type "${typeName}" has no accessible target entities (resolvable @key directives) in any other subgraph, so accessing other subgraphs is not possible.`,
    );
  }
  return reasons;
}

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

export function generateEntityResolvabilityErrors({
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
    // Reflect whence the resolvability error came accurately.
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

export function generateSharedEntityResolvabilityErrors({
  entityAncestors,
  resDataByPath,
  pathFromRoot,
  rootFieldData,
  subgraphNameByUnresolvablePath,
}: SharedResolvabilityErrorsParams): Array<Error> {
  const errors = new Array<Error>();
  for (const path of subgraphNameByUnresolvablePath.keys()) {
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
    // Reflect whence the resolvability error came accurately.
    for (const unresolvableFieldData of unresolvableFieldDatas) {
      errors.push(
        unresolvablePathError(
          unresolvableFieldData,
          generateSharedResolvabilityErrorReasons({ rootFieldData, unresolvableFieldData, entityAncestors }),
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

import { type ConstDirectiveNode, type ConstValueNode, Kind, type SelectionSetNode } from 'graphql';
import { type FederatedDirectivesData, type ParentDefinitionData } from '../../schema-building/types/types';
import { getFromContextFieldValue, isParentDataCompositeOutputType } from '../../schema-building/utils';
import { getDirectiveStringArgumentValue, safeParse, stringToNameNode } from '../../ast/utils';
import { getValueOrDefault } from '../../utils/utils';
import { missingTransitivePolicyRequirementsError } from '../../errors/errors';
import {
  type ContextName,
  type DirectiveName,
  type FieldCoords,
  type PolicyName,
  type TypeName,
} from '../../types/types';
import {
  CONTEXT,
  FROM_CONTEXT,
  INTERFACE_OBJECT,
  NAME,
  POLICIES,
  POLICY,
  REQUIRES,
} from '../../utils/string-constants';
import { type ORPolicies, type UnsatisfiedPolicyData } from './types/types';
import {
  type GatherUnsatisfiedPoliciesParams,
  type GetFieldPoliciesIncludingParentParams,
  type MergePolicyDirectivesParams,
  type ValidateTransitivePolicyRequirementsParams,
} from './types/params';
import { addScopes, isObjectDefinitionData } from '../utils/utils';

function getPoliciesKey(orPolicies: ORPolicies): string {
  return JSON.stringify(orPolicies.map((andPolicies) => [...andPolicies]));
}

/** Unlike localeCompare, this orders by code unit, e.g., "B" before "a". */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** An empty disjunction is no requirement, so it is sorted as a single empty conjunction. */
function sortPolicies(orPolicies: ORPolicies): Array<Array<PolicyName>> {
  return (orPolicies.length > 0 ? orPolicies : [new Set<PolicyName>()])
    .map((andPolicies) => [...andPolicies].sort())
    .sort((a, b) => compareCodeUnits(JSON.stringify(a), JSON.stringify(b)));
}

/**
 * Each value is a disjunction of conjunctions, and the result requires all of them.
 * The order of the result depends on the order of the values, so the values must be in a deterministic order.
 */
function mergePoliciesByAND(values: Array<ORPolicies>): ORPolicies {
  const uniqueValuesByKey = new Map<string, ORPolicies>();
  for (const orPolicies of values) {
    const sortedPolicies = sortPolicies(orPolicies);
    uniqueValuesByKey.set(
      JSON.stringify(sortedPolicies),
      sortedPolicies.map((andPolicies) => new Set<PolicyName>(andPolicies)),
    );
  }
  const uniqueValues = [...uniqueValuesByKey.values()];
  let mergedPolicies = uniqueValues[0] ?? [];
  for (const orPolicies of uniqueValues.slice(1)) {
    const productsByKey = new Map<string, Set<PolicyName>>();
    for (const mergedANDPolicies of mergedPolicies) {
      for (const andPolicies of orPolicies) {
        const product = [...new Set<PolicyName>([...mergedANDPolicies, ...andPolicies])].sort();
        productsByKey.set(JSON.stringify(product), new Set<PolicyName>(product));
      }
    }
    // addScopes drops any conjunction that requires a superset of another; adding the shortest first sets the order.
    mergedPolicies = [];
    for (const product of [...productsByKey.values()].sort((a, b) => a.size - b.size)) {
      addScopes(mergedPolicies, product);
    }
  }
  return mergedPolicies;
}

/** A single value is coerced to a list, so either level of the argument may not be a list. */
function valueNodeToORPolicies(valueNode: ConstValueNode): ORPolicies {
  const orValueNodes = valueNode.kind === Kind.LIST ? valueNode.values : [valueNode];
  return orValueNodes.map((andValueNode) => {
    const andPolicies = new Set<PolicyName>();
    for (const policyNode of andValueNode.kind === Kind.LIST ? andValueNode.values : [andValueNode]) {
      // Normalization has already validated that every policy is a string.
      if (policyNode.kind === Kind.STRING) {
        andPolicies.add(policyNode.value);
      }
    }
    return andPolicies;
  });
}

function getPolicies(directivesByName?: Map<DirectiveName, Array<ConstDirectiveNode>>): ORPolicies | undefined {
  const directiveNode = directivesByName?.get(POLICY)?.[0];
  const valueNode = directiveNode?.arguments?.find((argument) => argument.name.value === POLICIES)?.value;
  return valueNode ? valueNodeToORPolicies(valueNode) : undefined;
}

function generatePolicyDirective(orPolicies: ORPolicies): ConstDirectiveNode {
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(POLICY),
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: stringToNameNode(POLICIES),
        value: {
          kind: Kind.LIST,
          values: orPolicies.map((andPolicies) => ({
            kind: Kind.LIST,
            values: [...andPolicies].map((policy) => ({ kind: Kind.STRING, value: policy })),
          })),
        },
      },
    ],
  };
}

/**
 * Applications that are written identically are kept as they are.
 * Otherwise, the policies of every application are required, and the result is sorted.
 */
function upsertPolicyDirective(federatedDirectivesData: FederatedDirectivesData, values: Array<ORPolicies>) {
  const uniqueValuesByKey = new Map<string, ORPolicies>();
  for (const orPolicies of values) {
    uniqueValuesByKey.set(getPoliciesKey(orPolicies), orPolicies);
  }
  const uniqueValues = [...uniqueValuesByKey.values()];
  if (uniqueValues.length < 1) {
    return;
  }
  federatedDirectivesData.directivesByName.set(POLICY, [
    generatePolicyDirective(uniqueValues.length === 1 ? uniqueValues[0] : mergePoliciesByAND(uniqueValues)),
  ]);
}

function getImplementedInterfaceTypeNames(
  parentDefinitionDataByTypeName: Map<TypeName, ParentDefinitionData>,
  typeName: TypeName,
): Set<TypeName> | undefined {
  const parentData = parentDefinitionDataByTypeName.get(typeName);
  return isObjectDefinitionData(parentData) ? parentData.implementedInterfaceTypeNames : undefined;
}

/**
 * The @policy values of each coordinate are merged only once all subgraphs have been federated, because the
 * policies of implementations are also merged into the interfaces they implement.
 * Normalization does not permit @policy on Interfaces, Interface fields, @interfaceObject types, or fields that define
 * @external, so only Objects and their fields propagate policies to Interfaces.
 */
export function mergePolicyDirectives({
  concreteTypeNamesByAbstractTypeName,
  parentDefinitionDataByTypeName,
  subgraphs,
}: MergePolicyDirectivesParams) {
  const orPoliciesByCoords = new Map<TypeName | FieldCoords, Array<ORPolicies>>();
  const implementationORPoliciesByCoords = new Map<TypeName | FieldCoords, Array<ORPolicies>>();
  // The values are merged in subgraph name order so that the result does not depend on the order of the subgraphs.
  for (const subgraph of [...subgraphs].sort((a, b) => compareCodeUnits(a.name, b.name))) {
    for (const parentData of subgraph.parentDefinitionDataByTypeName.values()) {
      const interfaceTypeNames =
        getImplementedInterfaceTypeNames(parentDefinitionDataByTypeName, parentData.name) ?? [];
      const typeORPolicies = getPolicies(parentData.directivesByName);
      if (typeORPolicies) {
        getValueOrDefault(orPoliciesByCoords, parentData.name, () => []).push(typeORPolicies);
        for (const interfaceTypeName of interfaceTypeNames) {
          getValueOrDefault(implementationORPoliciesByCoords, interfaceTypeName, () => []).push(typeORPolicies);
        }
      }
      if (!isParentDataCompositeOutputType(parentData)) {
        continue;
      }
      const isInterfaceObject = parentData.directivesByName.has(INTERFACE_OBJECT);
      for (const fieldData of parentData.fieldDataByName.values()) {
        const fieldORPolicies = getPolicies(fieldData.directivesByName);
        if (!fieldORPolicies) {
          continue;
        }
        getValueOrDefault(orPoliciesByCoords, fieldData.federatedCoords, () => []).push(fieldORPolicies);
        if (!isInterfaceObject) {
          for (const interfaceTypeName of interfaceTypeNames) {
            getValueOrDefault(
              implementationORPoliciesByCoords,
              `${interfaceTypeName}.${fieldData.name}`,
              () => [],
            ).push(fieldORPolicies);
          }
          continue;
        }
        // An @interfaceObject field is also a field of every implementation and of their other interfaces.
        // For example, if the @interfaceObject "A" is implemented by "Object", which also implements "B", the
        // policies of "A.field" are propagated to "Object.field" and "B.field".
        const otherInterfaceTypeNames = new Set<TypeName>();
        for (const implementationTypeName of concreteTypeNamesByAbstractTypeName.get(parentData.name) ?? []) {
          getValueOrDefault(
            implementationORPoliciesByCoords,
            `${implementationTypeName}.${fieldData.name}`,
            () => [],
          ).push(fieldORPolicies);
          for (const interfaceTypeName of getImplementedInterfaceTypeNames(
            parentDefinitionDataByTypeName,
            implementationTypeName,
          ) ?? []) {
            if (interfaceTypeName !== parentData.name) {
              otherInterfaceTypeNames.add(interfaceTypeName);
            }
          }
        }
        for (const interfaceTypeName of otherInterfaceTypeNames) {
          getValueOrDefault(implementationORPoliciesByCoords, `${interfaceTypeName}.${fieldData.name}`, () => []).push(
            fieldORPolicies,
          );
        }
      }
    }
  }
  for (const parentData of parentDefinitionDataByTypeName.values()) {
    upsertPolicyDirective(parentData.federatedDirectivesData, [
      ...(orPoliciesByCoords.get(parentData.name) ?? []),
      ...(parentData.kind === Kind.INTERFACE_TYPE_DEFINITION
        ? (implementationORPoliciesByCoords.get(parentData.name) ?? [])
        : []),
    ]);
    if (!isParentDataCompositeOutputType(parentData)) {
      continue;
    }
    for (const fieldData of parentData.fieldDataByName.values()) {
      upsertPolicyDirective(fieldData.federatedDirectivesData, [
        ...(orPoliciesByCoords.get(fieldData.federatedCoords) ?? []),
        ...(implementationORPoliciesByCoords.get(fieldData.federatedCoords) ?? []),
      ]);
    }
  }
}

/** Whether a client that satisfies the defined policies always satisfies the required policies. */
function doesSatisfyPolicies(definedPolicies?: ORPolicies, requiredPolicies?: ORPolicies): boolean {
  const definedORPolicies = definedPolicies && definedPolicies.length > 0 ? definedPolicies : [new Set<PolicyName>()];
  const requiredORPolicies =
    requiredPolicies && requiredPolicies.length > 0 ? requiredPolicies : [new Set<PolicyName>()];
  return definedORPolicies.every((definedANDPolicies) =>
    requiredORPolicies.some((requiredANDPolicies) => requiredANDPolicies.isSubsetOf(definedANDPolicies)),
  );
}

function parseSelectionSetString(selection: string): SelectionSetNode | undefined {
  const { documentNode } = safeParse(selection.trim().startsWith('{') ? selection : `{${selection}}`);
  const definition = documentNode?.definitions[0];
  return definition?.kind === Kind.OPERATION_DEFINITION ? definition.selectionSet : undefined;
}

function getFieldPoliciesIncludingParent({
  fieldName,
  parentDefinitionDataByTypeName,
  parentTypeName,
}: GetFieldPoliciesIncludingParentParams): ORPolicies | undefined {
  const parentData = parentDefinitionDataByTypeName.get(parentTypeName);
  if (!parentData || !isParentDataCompositeOutputType(parentData)) {
    return;
  }
  const orPoliciesToMerge = [
    getPolicies(parentData.federatedDirectivesData.directivesByName),
    getPolicies(parentData.fieldDataByName.get(fieldName)?.federatedDirectivesData.directivesByName),
  ].filter((orPolicies): orPolicies is ORPolicies => orPolicies !== undefined);
  return orPoliciesToMerge.length > 0 ? mergePoliciesByAND(orPoliciesToMerge) : undefined;
}

function newUnsatisfiedPolicyData(): UnsatisfiedPolicyData {
  return { fieldCoords: new Set<FieldCoords>(), typeNames: new Set<TypeName>() };
}

function isUnsatisfiedPolicyDataEmpty(data: UnsatisfiedPolicyData): boolean {
  return data.fieldCoords.size < 1 && data.typeNames.size < 1;
}

function gatherUnsatisfiedPolicies({
  data,
  definedPolicies,
  parentDefinitionDataByTypeName,
  parentTypeName,
  selectionSet,
}: GatherUnsatisfiedPoliciesParams) {
  const parentData = parentDefinitionDataByTypeName.get(parentTypeName);
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      continue;
    }
    let nestedParentTypeName = parentTypeName;
    if (selection.kind === Kind.FIELD) {
      const fieldData =
        parentData && isParentDataCompositeOutputType(parentData)
          ? parentData.fieldDataByName.get(selection.name.value)
          : undefined;
      // A @requires field set has been validated by normalization, but a @fromContext selection has not.
      // So a selection of a field that does not exist is skipped rather than reported.
      if (!fieldData) {
        continue;
      }
      if (!doesSatisfyPolicies(definedPolicies, getPolicies(fieldData.federatedDirectivesData.directivesByName))) {
        data.fieldCoords.add(fieldData.federatedCoords);
      }
      const namedTypePolicies = getPolicies(
        parentDefinitionDataByTypeName.get(fieldData.namedTypeName)?.federatedDirectivesData.directivesByName,
      );
      if (!doesSatisfyPolicies(definedPolicies, namedTypePolicies)) {
        data.typeNames.add(fieldData.namedTypeName);
      }
      nestedParentTypeName = fieldData.namedTypeName;
    } else {
      const typeConditionName = selection.typeCondition?.name.value;
      if (typeConditionName) {
        const typeConditionPolicies = getPolicies(
          parentDefinitionDataByTypeName.get(typeConditionName)?.federatedDirectivesData.directivesByName,
        );
        if (!doesSatisfyPolicies(definedPolicies, typeConditionPolicies)) {
          data.typeNames.add(typeConditionName);
        }
        nestedParentTypeName = typeConditionName;
      }
    }
    if (selection.selectionSet) {
      gatherUnsatisfiedPolicies({
        data,
        definedPolicies,
        parentDefinitionDataByTypeName,
        parentTypeName: nestedParentTypeName,
        selectionSet: selection.selectionSet,
      });
    }
  }
}

/**
 * A field that accesses data through @requires or @fromContext must define at least the @policy requirements of
 * that data, otherwise the data would be exposed to clients that do not satisfy them.
 */
export function validateTransitivePolicyRequirements(params: ValidateTransitivePolicyRequirementsParams) {
  validateRequiresPolicyRequirements(params);
  validateFromContextPolicyRequirements(params);
}

function validateRequiresPolicyRequirements({
  errors,
  parentDefinitionDataByTypeName,
  subgraphs,
}: ValidateTransitivePolicyRequirementsParams) {
  for (const subgraph of subgraphs) {
    // Only the field sets that passed normalization are stored in the configuration data.
    for (const [parentTypeName, configurationData] of subgraph.configurationDataByTypeName) {
      for (const { fieldName, selectionSet: fieldSet } of configurationData.requires ?? []) {
        const selectionSet = parseSelectionSetString(fieldSet);
        if (!selectionSet) {
          continue;
        }
        const data = newUnsatisfiedPolicyData();
        gatherUnsatisfiedPolicies({
          data,
          definedPolicies: getFieldPoliciesIncludingParent({
            fieldName,
            parentDefinitionDataByTypeName,
            parentTypeName,
          }),
          parentDefinitionDataByTypeName,
          parentTypeName,
          selectionSet,
        });
        if (isUnsatisfiedPolicyDataEmpty(data)) {
          continue;
        }
        errors.push(
          missingTransitivePolicyRequirementsError({
            directiveName: REQUIRES,
            fieldCoords: `${parentTypeName}.${fieldName}`,
            subgraphName: subgraph.name,
            unsatisfiedFieldCoords: [...data.fieldCoords],
            unsatisfiedTypeNames: [...data.typeNames],
          }),
        );
      }
    }
  }
}

function validateFromContextPolicyRequirements({
  errors,
  parentDefinitionDataByTypeName,
  subgraphs,
}: ValidateTransitivePolicyRequirementsParams) {
  for (const subgraph of subgraphs) {
    const typeNamesByContextName = new Map<ContextName, Array<TypeName>>();
    for (const parentData of subgraph.parentDefinitionDataByTypeName.values()) {
      for (const directiveNode of parentData.directivesByName.get(CONTEXT) ?? []) {
        const contextName = getDirectiveStringArgumentValue(directiveNode, NAME);
        if (contextName !== undefined) {
          getValueOrDefault(typeNamesByContextName, contextName, () => []).push(parentData.name);
        }
      }
    }
    if (typeNamesByContextName.size < 1) {
      continue;
    }
    for (const parentData of subgraph.parentDefinitionDataByTypeName.values()) {
      if (!isParentDataCompositeOutputType(parentData)) {
        continue;
      }
      for (const fieldData of parentData.fieldDataByName.values()) {
        for (const argumentData of fieldData.argumentDataByName.values()) {
          // A @fromContext field value that cannot be parsed is skipped, because it is not validated yet.
          const fromContextFieldValue = getFromContextFieldValue(argumentData);
          if (!fromContextFieldValue) {
            continue;
          }
          const definedPolicies = getFieldPoliciesIncludingParent({
            fieldName: fieldData.name,
            parentDefinitionDataByTypeName,
            parentTypeName: parentData.name,
          });
          const data = newUnsatisfiedPolicyData();
          const selectionSet = parseSelectionSetString(fromContextFieldValue.selection);
          for (const contextTypeName of typeNamesByContextName.get(fromContextFieldValue.contextName) ?? []) {
            const contextTypePolicies = getPolicies(
              parentDefinitionDataByTypeName.get(contextTypeName)?.federatedDirectivesData.directivesByName,
            );
            if (!doesSatisfyPolicies(definedPolicies, contextTypePolicies)) {
              data.typeNames.add(contextTypeName);
            }
            if (selectionSet) {
              gatherUnsatisfiedPolicies({
                data,
                definedPolicies,
                parentDefinitionDataByTypeName,
                parentTypeName: contextTypeName,
                selectionSet,
              });
            }
          }
          if (isUnsatisfiedPolicyDataEmpty(data)) {
            continue;
          }
          errors.push(
            missingTransitivePolicyRequirementsError({
              argumentCoords: argumentData.federatedCoords,
              directiveName: FROM_CONTEXT,
              fieldCoords: fieldData.federatedCoords,
              subgraphName: subgraph.name,
              unsatisfiedFieldCoords: [...data.fieldCoords],
              unsatisfiedTypeNames: [...data.typeNames],
            }),
          );
        }
      }
    }
  }
}

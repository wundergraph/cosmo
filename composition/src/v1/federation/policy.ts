import { type ConstDirectiveNode, type ConstValueNode, Kind } from 'graphql';
import { type FederatedDirectivesData } from '../../schema-building/types/types';
import { isParentDataCompositeOutputType } from '../../schema-building/utils';
import { stringToNameNode } from '../../ast/utils';
import { getValueOrDefault } from '../../utils/utils';
import { type DirectiveName, type FieldCoords, type PolicyName, type TypeName } from '../../types/types';
import { POLICIES, POLICY } from '../../utils/string-constants';
import { type ORPolicies } from './types/types';
import { type MergePolicyDirectivesParams } from './types/params';
import { addScopes } from '../utils/utils';

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

/**
 * The @policy values of each coordinate are merged only once all subgraphs have been collected.
 * Normalization does not permit @policy on Interfaces, Interface fields, @interfaceObject types, or fields that define
 * @external, so only Objects and their fields carry policies here.
 */
export function mergePolicyDirectives({ parentDefinitionDataByTypeName, subgraphs }: MergePolicyDirectivesParams) {
  const orPoliciesByCoords = new Map<TypeName | FieldCoords, Array<ORPolicies>>();
  // The values are merged in subgraph name order so that the result does not depend on the order of the subgraphs.
  for (const subgraph of [...subgraphs].sort((a, b) => compareCodeUnits(a.name, b.name))) {
    for (const parentData of subgraph.parentDefinitionDataByTypeName.values()) {
      const typeORPolicies = getPolicies(parentData.directivesByName);
      if (typeORPolicies) {
        getValueOrDefault(orPoliciesByCoords, parentData.name, () => []).push(typeORPolicies);
      }
      if (!isParentDataCompositeOutputType(parentData)) {
        continue;
      }
      for (const fieldData of parentData.fieldDataByName.values()) {
        const fieldORPolicies = getPolicies(fieldData.directivesByName);
        if (fieldORPolicies) {
          getValueOrDefault(orPoliciesByCoords, fieldData.federatedCoords, () => []).push(fieldORPolicies);
        }
      }
    }
  }
  for (const parentData of parentDefinitionDataByTypeName.values()) {
    upsertPolicyDirective(parentData.federatedDirectivesData, orPoliciesByCoords.get(parentData.name) ?? []);
    if (!isParentDataCompositeOutputType(parentData)) {
      continue;
    }
    for (const fieldData of parentData.fieldDataByName.values()) {
      upsertPolicyDirective(fieldData.federatedDirectivesData, orPoliciesByCoords.get(fieldData.federatedCoords) ?? []);
    }
  }
}

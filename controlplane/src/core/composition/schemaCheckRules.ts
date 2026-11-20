import { Change, ChangeType, CriticalityLevel, Rule } from '@graphql-inspector/core';
import { INACCESSIBLE } from '@wundergraph/composition';
import { GraphQLSchema, isEnumType } from 'graphql';

type ChangePredicate = (change: Change, oldSchema: GraphQLSchema, newSchema: GraphQLSchema) => boolean;

function setCriticalityLevelWhen(level: CriticalityLevel, predicate: ChangePredicate): Rule {
  return ({ changes, oldSchema, newSchema }) =>
    changes.map((change) =>
      predicate(change, oldSchema, newSchema) ? { ...change, criticality: { ...change.criticality, level } } : change,
    );
}

export const enumValueChangesBreakExhaustiveSwitches = setCriticalityLevelWhen(
  CriticalityLevel.Breaking,
  isEnumValueChange,
);

/**
 * If @inaccessible in this subgraph hides or exposes a value another subgraph defines, the client schema diff reports it.
 */
export const inaccessibleEnumValueChangesAreInvisible = setCriticalityLevelWhen(
  CriticalityLevel.NonBreaking,
  isInaccessibleEnumValueChange,
);

function isEnumValueChange(change: Change): boolean {
  return change.type === ChangeType.EnumValueAdded || change.type === ChangeType.EnumValueRemoved;
}

function isInaccessibleEnumValueChange(change: Change, oldSchema: GraphQLSchema, newSchema: GraphQLSchema): boolean {
  switch (change.type) {
    case ChangeType.EnumValueAdded: {
      return isInaccessibleEnumValue(newSchema, change.meta.enumName, change.meta.addedEnumValueName);
    }
    case ChangeType.EnumValueRemoved: {
      return isInaccessibleEnumValue(oldSchema, change.meta.enumName, change.meta.removedEnumValueName);
    }
    default: {
      return false;
    }
  }
}

function isInaccessibleEnumValue(schema: GraphQLSchema, enumName: string, valueName: string): boolean {
  const enumType = schema.getType(enumName);
  if (!isEnumType(enumType)) {
    return false;
  }
  const nodes = [enumType.astNode, enumType.getValue(valueName)?.astNode];
  return nodes.some((node) => node?.directives?.some((directive) => directive.name.value === INACCESSIBLE));
}

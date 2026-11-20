import { Change, ChangeType, CriticalityLevel, Rule } from '@graphql-inspector/core';
import { GraphQLSchema } from 'graphql';

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

function isEnumValueChange(change: Change): boolean {
  return change.type === ChangeType.EnumValueAdded || change.type === ChangeType.EnumValueRemoved;
}

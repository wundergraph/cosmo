import { Change, ChangeType, CriticalityLevel, Rule } from '@graphql-inspector/core';
import { IGNORED_FEDERATED_TYPE_NAMES, INACCESSIBLE, TYPE_SYSTEM_DIRECTIVE_LOCATIONS } from '@wundergraph/composition';
import { DirectableGraphQLObject, getDirectiveInExtensions } from '@graphql-tools/utils';
import { GraphQLSchema, isEnumType, isInputObjectType, isInterfaceType, isObjectType } from 'graphql';

type ChangePredicate = (change: Change, oldSchema: GraphQLSchema, newSchema: GraphQLSchema) => boolean;

function setCriticalityLevelWhen(level: CriticalityLevel, predicate: ChangePredicate): Rule {
  return ({ changes, oldSchema, newSchema }) =>
    changes.map((change) =>
      predicate(change, oldSchema, newSchema) ? { ...change, criticality: { ...change.criticality, level } } : change,
    );
}

/**
 * Clients commonly switch over enums, so adding or removing a value can leave those switches unhandled.
 */
export const enumValuesAreExhaustive = setCriticalityLevelWhen(CriticalityLevel.Breaking, isEnumValueChange);

/**
 * @inaccessible in one subgraph hides an element from every client. If this subgraph hides or exposes something another
 * subgraph defines, the client schema diff reports it.
 */
export const inaccessibleChangesAreInvisible = setCriticalityLevelWhen(
  CriticalityLevel.NonBreaking,
  isInaccessibleChange,
);

/**
 * Operations can only use executable directives, so clients never see a type system directive.
 */
export const typeSystemDirectiveRemovalsAreInvisible = setCriticalityLevelWhen(
  CriticalityLevel.NonBreaking,
  isTypeSystemDirectiveRemoval,
);

/**
 * Clients reach these types only through fields that use them, and removing such a field is reported on its own.
 */
export const internalFederationTypeRemovalsAreInvisible = setCriticalityLevelWhen(
  CriticalityLevel.NonBreaking,
  isInternalFederationTypeRemoval,
);

/**
 * Rules are applied in order, and a later rule overrides the criticality an earlier one set for the same change.
 */
export const schemaCheckRules = [
  enumValuesAreExhaustive,
  inaccessibleChangesAreInvisible,
  typeSystemDirectiveRemovalsAreInvisible,
  internalFederationTypeRemovalsAreInvisible,
];

function isEnumValueChange(change: Change): boolean {
  return change.type === ChangeType.EnumValueAdded || change.type === ChangeType.EnumValueRemoved;
}

function isInaccessibleChange(change: Change, oldSchema: GraphQLSchema, newSchema: GraphQLSchema): boolean {
  return isInaccessibleAtChangePath(oldSchema, change.path) || isInaccessibleAtChangePath(newSchema, change.path);
}

function isInaccessibleAtChangePath(schema: GraphQLSchema, changePath: string | undefined): boolean {
  if (!changePath) {
    return false;
  }
  return elementsAlongChangePath(schema, changePath.split('.')).some(
    (element) => element && getDirectiveInExtensions(element, INACCESSIBLE),
  );
}

function elementsAlongChangePath(
  schema: GraphQLSchema,
  [typeName, childName = '', argumentName = '']: string[],
): Array<DirectableGraphQLObject | null | undefined> {
  const type = schema.getType(typeName);
  if (isEnumType(type)) {
    return [type, type.getValue(childName)];
  }
  if (isObjectType(type) || isInterfaceType(type)) {
    const field = type.getFields()[childName];
    return [type, field, field?.args.find((arg) => arg.name === argumentName)];
  }
  if (isInputObjectType(type)) {
    return [type, type.getFields()[childName]];
  }
  return [type];
}

function isTypeSystemDirectiveRemoval(change: Change, oldSchema: GraphQLSchema): boolean {
  return (
    change.type === ChangeType.DirectiveRemoved && isTypeSystemDirective(oldSchema, change.meta.removedDirectiveName)
  );
}

function isTypeSystemDirective(schema: GraphQLSchema, directiveName: string): boolean {
  const directive = schema.getDirective(directiveName);
  return !!directive && directive.locations.every((location) => TYPE_SYSTEM_DIRECTIVE_LOCATIONS.has(location));
}

function isInternalFederationTypeRemoval(change: Change): boolean {
  return change.type === ChangeType.TypeRemoved && IGNORED_FEDERATED_TYPE_NAMES.has(change.meta.removedTypeName);
}

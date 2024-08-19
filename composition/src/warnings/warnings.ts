import { QUOTATION_JOIN } from '../utils/string-constants';
import { FieldSetDirective } from '../schema-building/utils';

export class Warning extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Warning';
  }
}

export function invalidOverrideTargetSubgraphNameWarning(
  subgraphName: string,
  parentTypeName: string,
  fieldNames: string[],
): Warning {
  return new Warning(
    `The object type "${parentTypeName}" defines the directive "@override(from: "${subgraphName})" on the following field` +
      (fieldNames.length > 1 ? 's' : '') +
      `: "` +
      fieldNames.join(QUOTATION_JOIN) +
      `".\n` +
      `The required "from" argument of type "String!" should be provided with an existing subgraph name.\n` +
      `However, a subgraph by the name of "${subgraphName}" does not exist.\n` +
      `If this subgraph has been recently deleted, remember to clean up unused @override directives that reference this subgraph.`,
  );
}

function versionOneWarningPropagationMessage(subgraphName: string): string {
  return (
    `The subgraph "${subgraphName}" is currently a "version one" subgraph, but if it were updated to "version two"` +
    ` in its current state, composition would be unsuccessful due to the following warning that would instead` +
    ` propagate as an error:\n`
  );
}

export function externalInterfaceFieldsWarning(
  subgraphName: string,
  typeName: string,
  fieldNames: Array<string>,
): Warning {
  return new Warning(
    versionOneWarningPropagationMessage(subgraphName) +
      `The interface "${typeName}" is invalid because the following field definition` +
      (fieldNames.length > 1 ? 's are' : ' is') +
      ` declared @external:\n "` +
      fieldNames.join(QUOTATION_JOIN) +
      `"\n` +
      `Interface fields should not be declared @external. This is because interface fields do not resolve directly,` +
      ` but the "@external" directive relates to whether a field instance can be resolved` +
      ` by the subgraph in which it is defined.`,
  );
}

export function nonExternalConditionalFieldWarning(
  originCoords: string,
  subgraphName: string,
  targetCoords: string,
  fieldSet: string,
  fieldSetDirective: FieldSetDirective,
): Warning {
  return new Warning(
    versionOneWarningPropagationMessage(subgraphName) +
      `The field "${originCoords}" in subgraph "${subgraphName}" defines a "@${fieldSetDirective}" directive with the following` +
      ` field set:\n "${fieldSet}".` +
      `\nHowever, neither the field "${targetCoords}" nor any of its field set ancestors are declared @external.` +
      `\nConsequently, "${targetCoords}" is already provided by subgraph "${subgraphName}" and should not form part of` +
      ` a "@${fieldSetDirective}" directive field set.`,
  );
}

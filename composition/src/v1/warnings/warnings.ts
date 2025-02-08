import { QUOTATION_JOIN } from '../utils/string-constants';
import { FieldSetDirective } from '../../schema-building/utils';
import { Warning } from '../../warnings/warnings';

export function invalidOverrideTargetSubgraphNameWarning(
  targetSubgraphName: string,
  parentTypeName: string,
  fieldNames: string[],
  originSubgraphName: string,
): Warning {
  return new Warning({
    message:
      `The Object type "${parentTypeName}" defines the directive "@override(from: "${targetSubgraphName}")" on the following field` +
      (fieldNames.length > 1 ? 's' : '') +
      `: "` +
      fieldNames.join(QUOTATION_JOIN) +
      `".\n` +
      `The required "from" argument of type "String!" should be provided with an existing subgraph name.\n` +
      `However, a subgraph by the name of "${targetSubgraphName}" does not exist.\n` +
      `If this subgraph has been recently deleted, remember to clean up unused "@override" directives that reference this subgraph.`,
    subgraph: {
      name: originSubgraphName,
    },
  });
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
  return new Warning({
    message:
      versionOneWarningPropagationMessage(subgraphName) +
      `The Interface "${typeName}" is invalid because the following Field definition` +
      (fieldNames.length > 1 ? 's are' : ' is') +
      ` declared "@external":\n "` +
      fieldNames.join(QUOTATION_JOIN) +
      `"\n` +
      `Interface Fields should not be declared "@external". This is because Interface Fields do not resolve directly,` +
      ` but the "@external" directive relates to whether a Field instance can be resolved` +
      ` by the subgraph in which it is defined.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function nonExternalConditionalFieldWarning(
  originCoords: string,
  subgraphName: string,
  targetCoords: string,
  fieldSet: string,
  fieldSetDirective: FieldSetDirective,
): Warning {
  return new Warning({
    message:
      versionOneWarningPropagationMessage(subgraphName) +
      `The Field "${originCoords}" in subgraph "${subgraphName}" defines a "@${fieldSetDirective}" directive with the following` +
      ` field set:\n "${fieldSet}".` +
      `\nHowever, neither the Field "${targetCoords}" nor any of its field set ancestors are declared @external.` +
      `\nConsequently, "${targetCoords}" is already provided by subgraph "${subgraphName}" and should not form part of` +
      ` a "@${fieldSetDirective}" directive field set.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

// TODO Temporarily only used as a warning
export function unimplementedInterfaceOutputTypeWarning(subgraphName: string, interfaceTypeName: string): Warning {
  return new Warning({
    message:
      `Subgraph "${subgraphName}": The Interface "${interfaceTypeName}" is used as an output type` +
      ` without at least one Object type implementation defined in the schema.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function invalidExternalFieldWarning(fieldCoords: string, subgraphName: string): Warning {
  return new Warning({
    message:
      versionOneWarningPropagationMessage(subgraphName) +
      ` The Object Field "${fieldCoords}" is invalidly declared "@external". An Object Field should only` +
      ` be declared "@external" if it is part of a "@key", "@provides", or "@requires" FieldSet, or the Field is` +
      ` necessary to satisfy an Interface implementation. In the case that none of these conditions is true, the` +
      ` "@external" directive should be removed.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function requiresDefinedOnNonEntityFieldWarning(fieldCoords: string, subgraphName: string): Warning {
  return new Warning({
    message:
      ` The Object Field "${fieldCoords}" defines a "@requires" directive, but the Object is not an entity.` +
      ' Consequently, the "@requires" FieldSet cannot be satisfied because there is no entity resolver with which to' +
      ' provide the required Fields.',
    subgraph: {
      name: subgraphName,
    },
  });
}

export function consumerInactiveThresholdInvalidValueWarning(
  subgraphName: string,
  additionalMsg: string = '',
): Warning {
  return new Warning({
    message:
      `The "consumerInactiveThreshold" argument of type "Int" should be positive and smaller than 2,147,483,648.` +
      +additionalMsg
        ? `\n${additionalMsg}`
        : '',
    subgraph: {
      name: subgraphName,
    },
  });
}

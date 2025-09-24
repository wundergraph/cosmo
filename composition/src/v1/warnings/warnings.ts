import { Warning } from '../../warnings/types';
import { QUOTATION_JOIN } from '../../utils/string-constants';
import { SingleFederatedInputFieldOneOfWarningParams, SingleSubgraphInputFieldOneOfWarningParams } from './params';

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
      `The Interface "${typeName}" is invalid because the following field definition` +
      (fieldNames.length > 1 ? 's are' : ' is') +
      ` declared "@external":\n "` +
      fieldNames.join(QUOTATION_JOIN) +
      `"\n` +
      `Interface fields should not be declared "@external". This is because Interface fields do not resolve directly,` +
      ` but the "@external" directive relates to whether a Field instance can be resolved` +
      ` by the subgraph in which it is defined.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function nonExternalConditionalFieldWarning(
  directiveCoords: string,
  subgraphName: string,
  targetCoords: string,
  fieldSet: string,
  fieldSetDirectiveName: string,
): Warning {
  return new Warning({
    message:
      versionOneWarningPropagationMessage(subgraphName) +
      `The Field "${directiveCoords}" in subgraph "${subgraphName}" defines a "@${fieldSetDirectiveName}" directive with` +
      ` the following field set:\n "${fieldSet}".` +
      `\nHowever, neither the field "${targetCoords}" nor any of its field set ancestors are declared @external.` +
      `\nConsequently, "${targetCoords}" is already provided by subgraph "${subgraphName}" and should not form part of` +
      ` a "@${fieldSetDirectiveName}" directive field set.`,
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
      ` The Object Field "${fieldCoords}" is invalidly declared "@external". An Object field should only` +
      ` be declared "@external" if it is part of a "@key", "@provides", or "@requires" field set, or the field is` +
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

export function externalEntityExtensionKeyFieldWarning(
  entityName: string,
  fieldSet: string,
  externalFieldCoordinates: Array<string>,
  subgraphName: string,
): Warning {
  return new Warning({
    message:
      `The entity extension "${entityName}" defined in subgraph "${subgraphName}" defines a "@key" directive` +
      ` with the field set "${fieldSet}".\nThe following field coordinates that form part of that field set are` +
      ` declared "@external":\n "` +
      externalFieldCoordinates.join(QUOTATION_JOIN) +
      `"\nPlease note fields that form part of` +
      ` entity extension "@key" field sets are always provided in that subgraph. Any such "@external" declarations` +
      ` are unnecessary relics of Federation Version 1 syntax and are effectively ignored.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function fieldAlreadyProvidedWarning(
  fieldCoords: string,
  directiveName: string,
  directiveCoords: string,
  subgraphName: string,
): Warning {
  return new Warning({
    message:
      versionOneWarningPropagationMessage(subgraphName) +
      `The field "${fieldCoords}" is unconditionally provided by subgraph "${subgraphName}" and should not form` +
      ` part of any "@${directiveName}" field set.` +
      `\nHowever, "${fieldCoords}" forms part of the "@${directiveName}" field set defined "${directiveCoords}".` +
      `\nAlthough "${fieldCoords}" is declared "@external", it is part of` +
      ` a "@key" directive on an extension type. Such fields are only declared "@external" for legacy syntactical` +
      ` reasons and are not internally considered "@external".`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function singleSubgraphInputFieldOneOfWarning({
  fieldName,
  subgraphName,
  typeName,
}: SingleSubgraphInputFieldOneOfWarningParams): Warning {
  return new Warning({
    message:
      `The directive "@oneOf" is defined on Input Object "${typeName}"` +
      `, but only one optional Input field, "${fieldName}", is defined.` +
      ` Consider removing "@oneOf" and changing "${fieldName}" to a required type instead.`,
    subgraph: {
      name: subgraphName,
    },
  });
}

export function singleFederatedInputFieldOneOfWarning({
  fieldName,
  typeName,
}: SingleFederatedInputFieldOneOfWarningParams): Warning {
  return new Warning({
    message:
      `The directive "@oneOf" is defined on Input Object "${typeName}"` +
      `, but only one optional Input field, "${fieldName}", is propagated to` +
      ` the federated graph. Consider removing "@oneOf", changing "${fieldName}"` +
      ` to a required type, and removing any other remaining optional Input fields instead.`,
    subgraph: {
      name: '',
    },
  });
}

import {
  DocumentNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
  SelectionSetNode,
  TypeNode,
  visit,
} from 'graphql';
import {
  ArgumentConfiguration,
  ArgumentRenderConfiguration,
  ArgumentSource,
  FieldConfiguration,
  RequiredField,
  TypeConfiguration,
  TypeField,
} from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { ConfigurationDataMap } from '@wundergraph/composition/dist/subgraph/field-configuration.js';

const DefaultJsonType = 'JSON';

export interface GraphQLConfiguration {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  fieldConfigs: FieldConfiguration[];
  typeConfigs: TypeConfiguration[];
}

export const configuration = (schema: DocumentNode, isFederationSubgraph: boolean): GraphQLConfiguration => {
  const config: GraphQLConfiguration = {
    rootNodes: [],
    childNodes: [],
    fieldConfigs: [],
    typeConfigs: [],
  };
  if (isFederationSubgraph) {
    visitSchema(schema, config, true);
  } else {
    visitSchema(schema, config, false);
  }
  return config;
};

export type DataSourceConfiguration = {
  rootNodes: TypeField[];
  childNodes: TypeField[];
  requiredFields: any;
};

export function configurationDataMapToDataSourceConfiguration(dataMap: ConfigurationDataMap) {
  const output: DataSourceConfiguration = {
    rootNodes: [],
    childNodes: [],
    requiredFields: [],
  };
  for (const [typeName, data] of dataMap) {
    const fieldNames: string[] = [...data.fieldNames];
    const typeField = new TypeField({ typeName, fieldNames });
    if (data.isRootNode) {
      output.rootNodes.push(typeField);
    } else {
      output.childNodes.push(typeField);
    }
    for (const selectionSet of data.selectionSets) {
      output.requiredFields.push(new RequiredField({ typeName, fieldName: '', selectionSet }));
    }
  }
  return output;
}

interface JsonTypeField {
  typeName: string;
  fieldName: string;
}

const visitSchema = (schema: DocumentNode, config: GraphQLConfiguration, isFederation: boolean) => {
  let typeName: undefined | string;
  let fieldName: undefined | string;
  let isExtensionType = false;
  let hasExtensionDirective = false;
  let isEntity = false;
  let isExternalField = false;
  let entityFields: string[] = [];
  const jsonFields: JsonTypeField[] = [];

  const jsonScalars = new Set<string>([DefaultJsonType]);

  const RootNodeNames = rootNodeNames(schema, isFederation);
  const isNodeRoot = (typeName: string) => {
    return RootNodeNames.includes(typeName);
  };

  visit(schema, {
    ObjectTypeDefinition: {
      enter: (node) => {
        typeName = node.name.value;
        isExtensionType = false;
        isEntity = false;
      },
      leave: () => {
        typeName = undefined;
        isExtensionType = false;
        hasExtensionDirective = false;
        entityFields = [];
        isEntity = false;
      },
    },
    InterfaceTypeDefinition: {
      enter: (node) => {
        typeName = node.name.value;
        isExtensionType = false;
        isEntity = false;
      },
      leave: () => {
        typeName = undefined;
        isExtensionType = false;
        hasExtensionDirective = false;
        entityFields = [];
        isEntity = false;
      },
    },
    ObjectTypeExtension: {
      enter: (node) => {
        typeName = node.name.value;
        isExtensionType = true;
        isEntity = false;
      },
      leave: () => {
        typeName = undefined;
        isExtensionType = false;
        hasExtensionDirective = false;
        entityFields = [];
      },
    },
    InterfaceTypeExtension: {
      enter: (node) => {
        typeName = node.name.value;
        isExtensionType = true;
        isEntity = false;
      },
      leave: () => {
        typeName = undefined;
        isExtensionType = false;
        hasExtensionDirective = false;
        entityFields = [];
      },
    },
    Directive: {
      enter: (node) => {
        switch (node.name.value) {
          case 'extends': {
            hasExtensionDirective = true;
            return;
          }
          case 'key': {
            isEntity = true;
            if (!node.arguments) {
              return;
            }
            const fields = node.arguments.find((arg) => arg.name.value === 'fields');
            if (!fields) {
              return;
            }
            if (fields.value.kind !== 'StringValue') {
              return;
            }
            const fieldsValue = fields.value.value;
            const fieldsSelection = parseSelectionSet('{ ' + fieldsValue + ' }');
            for (const s of fieldsSelection.selections) {
              if (s.kind !== 'Field') {
                continue;
              }
              entityFields.push(s.name.value);
            }
            return;
          }
          case 'external': {
            isExternalField = true;
          }
        }
      },
    },
    FieldDefinition: {
      enter: (node) => {
        fieldName = node.name.value;

        if (jsonScalars.has(resolveNamedTypeName(node.type))) {
          jsonFields.push({ typeName: typeName!, fieldName: fieldName! });
        }
      },
      leave: () => {
        if (typeName === undefined || fieldName === undefined) {
          return;
        }
        const isRoot = isNodeRoot(typeName);
        if (isRoot) {
          addTypeField(config.rootNodes, typeName, fieldName);
        }

        const isExtension = isExtensionType || hasExtensionDirective;
        const isFederationRootNode = isExtension && isEntity && !isExternalField;
        const isEntityField = entityFields.includes(fieldName);

        if (isEntity && !isExternalField) {
          addTypeField(config.rootNodes, typeName, fieldName);
        }

        if (isFederationRootNode) {
          addTypeField(config.rootNodes, typeName, fieldName);
          // addRequiredFields(typeName, fieldName, config, entityFields);
        }

        if (!isRoot && !isFederationRootNode && !isExternalField) {
          addTypeField(config.childNodes, typeName, fieldName);
        }

        if (isExternalField && isEntityField) {
          addTypeField(config.childNodes, typeName, fieldName);
        }

        if (isEntity && !isEntityField && !isExternalField && !isFederationRootNode) {
          // addRequiredFields(typeName, fieldName, config, entityFields);
        }

        fieldName = undefined;
        isExternalField = false;
      },
    },
    InputValueDefinition: {
      enter: (node) => {
        if (!fieldName || !typeName) {
          return;
        }
        addFieldArgument(typeName, fieldName, node.name.value, config);
      },
    },
  });

  addJsonFieldConfigurations(config, jsonFields);
};

const parseSelectionSet = (selectionSet: string): SelectionSetNode => {
  const query = parse(selectionSet).definitions[0] as OperationDefinitionNode;
  return query.selectionSet;
};

const rootNodeNames = (schema: DocumentNode, isFederation: boolean): string[] => {
  const rootTypes = new Set<string>();
  visit(schema, {
    SchemaDefinition: {
      enter: (node) => {
        for (const operationType of node.operationTypes) {
          rootTypes.add(operationType.type.name.value);
        }
      },
    },
    ObjectTypeDefinition: {
      enter: (node) => {
        switch (node.name.value) {
          case 'Query':
          case 'Mutation':
          case 'Subscription': {
            rootTypes.add(node.name.value);
          }
        }
      },
    },
    ObjectTypeExtension: {
      enter: (node) => {
        if (!isFederation) {
          return;
        }
        switch (node.name.value) {
          case 'Query':
          case 'Mutation':
          case 'Subscription': {
            rootTypes.add(node.name.value);
          }
        }
      },
    },
  });

  return [...rootTypes.values()];
};

export const isRootType = (typeName: string, schema: GraphQLSchema): boolean => {
  const queryType = schema.getQueryType();
  if (queryType && queryType.astNode && queryType.astNode.name.value === typeName) {
    return true;
  }
  const mutationType = schema.getMutationType();
  if (mutationType && mutationType.astNode && mutationType.astNode.name.value === typeName) {
    return true;
  }
  const subscriptionType = schema.getSubscriptionType();
  if (subscriptionType && subscriptionType.astNode && subscriptionType.astNode.name.value === typeName) {
    return true;
  }
  const typeDefinition = schema.getType(typeName);
  if (
    typeDefinition === undefined ||
    typeDefinition === null ||
    typeDefinition.astNode === undefined ||
    typeDefinition.astNode === null
  ) {
    return false;
  }
  return false;
};

const addTypeField = (typeFields: TypeField[], typeName: string, fieldName: string) => {
  const i = typeFields.findIndex((t) => t.typeName === typeName);
  if (i !== -1) {
    addField(typeFields[i], fieldName);
    return;
  }
  const typeField: TypeField = new TypeField({
    typeName,
    fieldNames: [],
  });
  addField(typeField, fieldName);
  typeFields.push(typeField);
};

const addField = (typeField: TypeField, field: string) => {
  const i = typeField.fieldNames.indexOf(field);
  if (i !== -1) {
    return;
  }
  typeField.fieldNames.push(field);
};

const addFieldArgument = (typeName: string, fieldName: string, argName: string, config: GraphQLConfiguration) => {
  const arg: ArgumentConfiguration = new ArgumentConfiguration({
    name: argName,
    sourceType: ArgumentSource.FIELD_ARGUMENT,
    sourcePath: [],
    renderConfiguration: ArgumentRenderConfiguration.RENDER_ARGUMENT_DEFAULT,
    renameTypeTo: '',
  });
  const field: FieldConfiguration | undefined = findField(config.fieldConfigs, typeName, fieldName);
  if (!field) {
    config.fieldConfigs.push(
      new FieldConfiguration({
        typeName,
        fieldName,
        argumentsConfiguration: [arg],
        disableDefaultFieldMapping: false,
        path: [],
        unescapeResponseJson: false,
      }),
    );
    return;
  }
  if (!field.argumentsConfiguration) {
    field.argumentsConfiguration = [arg];
    return;
  }
  const i = field.argumentsConfiguration.findIndex((a: ArgumentConfiguration) => a.name === argName);
  if (i !== -1) {
    field.argumentsConfiguration[i] = arg;
    return;
  }
  field.argumentsConfiguration.push(arg);
};

// const addRequiredFields = (
//   typeName: string,
//   fieldName: string,
//   config: GraphQLConfiguration,
//   requiredFieldNames: string[],
// ) => {
//   for (const f of requiredFieldNames) {
//     addRequiredField(typeName, fieldName, config, f);
//   }
// };

// const addRequiredField = (
//   typeName: string,
//   fieldName: string,
//   config: GraphQLConfiguration,
//   requiredFieldName: string,
// ) => {
//   const field: FieldConfiguration | undefined = findField(config.fieldConfigs, typeName, fieldName);
//   if (!field) {
//     config.fieldConfigs.push(
//       new FieldConfiguration({
//         typeName,
//         fieldName,
//         argumentsConfiguration: [],
//         path: [],
//         disableDefaultFieldMapping: false,
//         unescapeResponseJson: false,
//       }),
//     );
//     return;
//   }
//   if (!field.requiresFields) {
//     field.requiresFields = [requiredFieldName];
//     return;
//   }
//   const exists = field.requiresFields.includes(requiredFieldName);
//   if (exists) {
//     return;
//   }
//   field.requiresFields.push(requiredFieldName);
// };

const addJsonFieldConfigurations = (config: GraphQLConfiguration, jsonFields: JsonTypeField[]) => {
  for (const jsonField of jsonFields) {
    const field: FieldConfiguration | undefined = findField(
      config.fieldConfigs,
      jsonField.typeName,
      jsonField.fieldName,
    );

    if (field) {
      field.unescapeResponseJson = true;
    } else {
      config.fieldConfigs.push(
        new FieldConfiguration({
          typeName: jsonField.typeName,
          fieldName: jsonField.fieldName,
          argumentsConfiguration: [],
          disableDefaultFieldMapping: false,
          path: [],
          unescapeResponseJson: true,
        }),
      );
    }
  }
};

const findField = (fields: FieldConfiguration[], typeName: string, fieldName: string) => {
  return fields.find((f) => f.typeName === typeName && f.fieldName === fieldName);
};

const resolveNamedTypeName = (type: TypeNode): string => {
  switch (type.kind) {
    case Kind.NON_NULL_TYPE: {
      return resolveNamedTypeName(type.type);
    }
    case Kind.LIST_TYPE: {
      return resolveNamedTypeName(type.type);
    }
    default: {
      return type.name.value;
    }
  }
};

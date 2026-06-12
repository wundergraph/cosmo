import {
  type ConstValueNode,
  type DirectiveDefinitionNode,
  type DirectiveNode,
  type DocumentNode,
  type EnumTypeDefinitionNode,
  type EnumValueDefinitionNode,
  type FieldDefinitionNode,
  type InputObjectTypeDefinitionNode,
  type InputValueDefinitionNode,
  type InterfaceTypeDefinitionNode,
  Kind,
  type NamedTypeNode,
  type ObjectTypeDefinitionNode,
  OperationTypeNode,
  type OperationTypeDefinitionNode,
  type ScalarTypeDefinitionNode,
  type SchemaDefinitionNode,
  type StringValueNode,
  type TypeNode,
  type UnionTypeDefinitionNode,
} from 'graphql';

// graphql v16's CJS root re-exports enum objects through getters; keep hot printer reads local.
const KindRef = Kind;
const OperationTypeNodeRef = OperationTypeNode;

import { printBlockString } from 'graphql/language/blockString.js';
import { printString } from 'graphql/language/printString.js';
import { naturalCompare } from 'graphql/jsutils/naturalCompare.js';

type TypeRef =
  | {
      kind: Kind.NAMED_TYPE;
      name: string;
    }
  | {
      kind: Kind.LIST_TYPE;
      type: TypeRef;
    }
  | {
      kind: Kind.NON_NULL_TYPE;
      type: TypeRef;
    };

type NamedTypeInfo =
  | {
      kind: 'scalar';
      name: string;
    }
  | {
      kind: 'enum';
      name: string;
      values: Set<string>;
    }
  | {
      fields?: Array<InputFieldInfo>;
      kind: 'input';
      name: string;
      node: InputObjectTypeDefinitionNode;
      oneOf: boolean;
    };

type InputFieldInfo = {
  defaultValue?: ConstValueNode;
  name: string;
  type: TypeRef;
};

type DirectiveInfo = {
  argByName: Map<string, InputFieldInfo>;
  args: Array<InputFieldInfo>;
  name: string;
};

type DefinitionInfo =
  | ObjectTypeDefinitionNode
  | InterfaceTypeDefinitionNode
  | UnionTypeDefinitionNode
  | EnumTypeDefinitionNode
  | InputObjectTypeDefinitionNode
  | ScalarTypeDefinitionNode;

type PrinterContext = {
  directiveDefinitionList: Array<DirectiveDefinitionNode>;
  directiveDefinitions: Map<string, DirectiveDefinitionNode>;
  directives: Map<string, DirectiveInfo>;
  schemaDefinition: SchemaDefinitionNode | undefined;
  typeDefinitionList: Array<DefinitionInfo>;
  typeDefinitions: Map<string, DefinitionInfo>;
  types: Map<string, NamedTypeInfo>;
};

const SPECIFIED_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
const SPECIFIED_DIRECTIVES = new Set(['include', 'skip', 'deprecated', 'specifiedBy', 'oneOf']);
const INT_REGEXP = /^-?(?:0|[1-9][0-9]*)$/;

export function printSortedSdl(document: DocumentNode): string {
  const context = buildContext(document);
  const chunks: Array<string> = [];
  printSchemaDefinition(context, chunks);
  printDirectiveDefinitions(context, chunks);
  printTypeDefinitions(context, chunks);
  if (chunks.length === 0) {
    return '';
  }
  let output = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    output += ' ' + chunks[i];
  }
  return output;
}

function buildContext(document: DocumentNode): PrinterContext {
  const typeDefinitions = new Map<string, DefinitionInfo>();
  const typeDefinitionList: Array<DefinitionInfo> = [];
  const directiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  const directiveDefinitionList: Array<DirectiveDefinitionNode> = [];
  let schemaDefinition: SchemaDefinitionNode | undefined;

  for (const definition of document.definitions) {
    switch (definition.kind) {
      case KindRef.SCHEMA_DEFINITION:
        schemaDefinition = definition;
        break;
      case KindRef.DIRECTIVE_DEFINITION:
        directiveDefinitions.set(definition.name.value, definition);
        directiveDefinitionList.push(definition);
        break;
      case KindRef.OBJECT_TYPE_DEFINITION:
      case KindRef.INTERFACE_TYPE_DEFINITION:
      case KindRef.UNION_TYPE_DEFINITION:
      case KindRef.ENUM_TYPE_DEFINITION:
      case KindRef.INPUT_OBJECT_TYPE_DEFINITION:
      case KindRef.SCALAR_TYPE_DEFINITION:
        typeDefinitions.set(definition.name.value, definition);
        typeDefinitionList.push(definition);
        break;
    }
  }

  const types = new Map<string, NamedTypeInfo>();
  for (const name of SPECIFIED_SCALARS) {
    types.set(name, { kind: 'scalar', name });
  }
  for (const definition of typeDefinitions.values()) {
    switch (definition.kind) {
      case KindRef.ENUM_TYPE_DEFINITION:
        types.set(definition.name.value, {
          kind: 'enum',
          name: definition.name.value,
          values: new Set((definition.values ?? []).map((value) => value.name.value)),
        });
        break;
      case KindRef.INPUT_OBJECT_TYPE_DEFINITION:
        types.set(definition.name.value, {
          kind: 'input',
          name: definition.name.value,
          node: definition,
          oneOf: hasDirective(definition.directives, 'oneOf'),
        });
        break;
      case KindRef.SCALAR_TYPE_DEFINITION:
        types.set(definition.name.value, { kind: 'scalar', name: definition.name.value });
        break;
    }
  }

  const directives = new Map<string, DirectiveInfo>();
  addSpecifiedDirectiveInfos(directives);
  for (const definition of directiveDefinitions.values()) {
    const args = sortedInputValues(definition.arguments).map(toInputFieldInfo);
    directives.set(definition.name.value, {
      argByName: new Map(args.map((arg) => [arg.name, arg])),
      args,
      name: definition.name.value,
    });
  }

  return {
    directiveDefinitionList,
    directiveDefinitions,
    directives,
    schemaDefinition,
    typeDefinitionList,
    typeDefinitions,
    types,
  };
}

function addSpecifiedDirectiveInfos(directives: Map<string, DirectiveInfo>): void {
  directives.set('deprecated', {
    argByName: new Map([
      [
        'reason',
        {
          defaultValue: {
            block: false,
            kind: KindRef.STRING,
            value: 'No longer supported',
          },
          name: 'reason',
          type: namedRef('String'),
        },
      ],
    ]),
    args: [
      {
        defaultValue: {
          block: false,
          kind: KindRef.STRING,
          value: 'No longer supported',
        },
        name: 'reason',
        type: namedRef('String'),
      },
    ],
    name: 'deprecated',
  });
  const specifiedByArg = { name: 'url', type: nonNullRef(namedRef('String')) };
  directives.set('specifiedBy', {
    argByName: new Map([['url', specifiedByArg]]),
    args: [specifiedByArg],
    name: 'specifiedBy',
  });
  directives.set('oneOf', { argByName: new Map(), args: [], name: 'oneOf' });
}

function printSchemaDefinition(context: PrinterContext, chunks: Array<string>): void {
  const operationTypes = getOperationTypes(context);
  const directives = context.schemaDefinition?.directives;
  if (operationTypes.length === 0 && (!directives || directives.length === 0)) {
    return;
  }
  let printed = '';
  const description = context.schemaDefinition?.description;
  if (description) {
    printed += printDescription(description) + '\n';
  }
  let schemaLine = operationTypes.length === 0 ? 'extend schema' : 'schema';
  const directiveString = printDirectives(directives, context);
  if (directiveString) {
    schemaLine += ' ' + directiveString;
  }
  const operationTypeStrings: Array<string> = [];
  for (const operationType of operationTypes) {
    operationTypeStrings.push(operationType.operation + ': ' + operationType.type.name.value);
  }
  chunks.push(printed + schemaLine + ' { ' + operationTypeStrings.join(' ') + ' }');
}

function getOperationTypes(context: PrinterContext): Array<OperationTypeDefinitionNode> {
  const operationTypeMap = new Map<string, OperationTypeDefinitionNode>();
  if (context.schemaDefinition) {
    for (const operationType of context.schemaDefinition.operationTypes) {
      operationTypeMap.set(operationType.operation, operationType);
    }
  } else {
    addInferredOperationType(context, operationTypeMap, OperationTypeNodeRef.QUERY, 'Query');
    addInferredOperationType(context, operationTypeMap, OperationTypeNodeRef.MUTATION, 'Mutation');
    addInferredOperationType(context, operationTypeMap, OperationTypeNodeRef.SUBSCRIPTION, 'Subscription');
  }
  const operationTypes: Array<OperationTypeDefinitionNode> = [];
  for (const operation of [
    OperationTypeNodeRef.QUERY,
    OperationTypeNodeRef.MUTATION,
    OperationTypeNodeRef.SUBSCRIPTION,
  ]) {
    const operationType = operationTypeMap.get(operation);
    if (operationType) {
      operationTypes.push(operationType);
    }
  }
  return operationTypes;
}

function addInferredOperationType(
  context: PrinterContext,
  operationTypeMap: Map<string, OperationTypeDefinitionNode>,
  operation: OperationTypeNode,
  typeName: string,
): void {
  if (!context.typeDefinitions.has(typeName)) {
    return;
  }
  operationTypeMap.set(operation, {
    kind: KindRef.OPERATION_TYPE_DEFINITION,
    operation,
    type: {
      kind: KindRef.NAMED_TYPE,
      name: {
        kind: KindRef.NAME,
        value: typeName,
      },
    },
  });
}

function printDirectiveDefinitions(context: PrinterContext, chunks: Array<string>): void {
  const definitions = sortByName(
    context.directiveDefinitionList.filter((definition) => !SPECIFIED_DIRECTIVES.has(definition.name.value)),
  );
  for (const definition of definitions) {
    const args = sortedInputValues(definition.arguments).map((arg) => printInputValueDefinition(arg, context));
    const description = definition.description ? printDescription(definition.description) + '\n' : '';
    chunks.push(
      description +
        'directive @' +
        definition.name.value +
        printWrappedArguments(args) +
        (definition.repeatable ? ' repeatable' : '') +
        ' on ' +
        sortedNameNodes(definition.locations)
          .map((location) => location.value)
          .join(' | '),
    );
  }
}

function printTypeDefinitions(context: PrinterContext, chunks: Array<string>): void {
  const definitions = sortByName(
    context.typeDefinitionList.filter((definition) => !shouldOmitTypeDefinition(definition)),
  );
  for (const definition of definitions) {
    switch (definition.kind) {
      case KindRef.OBJECT_TYPE_DEFINITION:
        chunks.push(printObjectTypeDefinition(definition, context));
        break;
      case KindRef.INTERFACE_TYPE_DEFINITION:
        chunks.push(printInterfaceTypeDefinition(definition, context));
        break;
      case KindRef.UNION_TYPE_DEFINITION:
        chunks.push(printUnionTypeDefinition(definition, context));
        break;
      case KindRef.ENUM_TYPE_DEFINITION:
        chunks.push(printEnumTypeDefinition(definition, context));
        break;
      case KindRef.INPUT_OBJECT_TYPE_DEFINITION:
        chunks.push(printInputObjectTypeDefinition(definition, context));
        break;
      case KindRef.SCALAR_TYPE_DEFINITION:
        chunks.push(printScalarTypeDefinition(definition, context));
        break;
    }
  }
}

function shouldOmitTypeDefinition(definition: DefinitionInfo): boolean {
  return (
    definition.name.value.startsWith('__') ||
    (definition.kind === KindRef.SCALAR_TYPE_DEFINITION && SPECIFIED_SCALARS.has(definition.name.value))
  );
}

function printObjectTypeDefinition(definition: ObjectTypeDefinitionNode, context: PrinterContext): string {
  const head = joinWords([
    'type',
    definition.name.value,
    printImplementedInterfaces(definition.interfaces),
    printDirectives(definition.directives, context),
  ]);
  return printDescribedNodesBlock(definition.description, head, sortedFieldDefinitions(definition.fields), (field) =>
    printFieldDefinition(field, context),
  );
}

function printInterfaceTypeDefinition(definition: InterfaceTypeDefinitionNode, context: PrinterContext): string {
  const head = joinWords([
    'interface',
    definition.name.value,
    printImplementedInterfaces(definition.interfaces),
    printDirectives(definition.directives, context),
  ]);
  return printDescribedNodesBlock(definition.description, head, sortedFieldDefinitions(definition.fields), (field) =>
    printFieldDefinition(field, context),
  );
}

function printUnionTypeDefinition(definition: UnionTypeDefinitionNode, context: PrinterContext): string {
  const types = sortedNamedTypes(definition.types);
  return withDescription(
    definition.description,
    joinWords([
      'union',
      definition.name.value,
      printDirectives(definition.directives, context),
      types.length > 0 ? '= ' + types.map((type) => type.name.value).join(' | ') : '',
    ]),
  );
}

function printEnumTypeDefinition(definition: EnumTypeDefinitionNode, context: PrinterContext): string {
  const head = joinWords(['enum', definition.name.value, printDirectives(definition.directives, context)]);
  return printDescribedNodesBlock(definition.description, head, sortedEnumValues(definition.values), (value) =>
    withDescription(value.description, joinWords([value.name.value, printDirectives(value.directives, context)])),
  );
}

function printInputObjectTypeDefinition(definition: InputObjectTypeDefinitionNode, context: PrinterContext): string {
  const head = joinWords(['input', definition.name.value, printDirectives(definition.directives, context)]);
  return printDescribedNodesBlock(definition.description, head, sortedInputValues(definition.fields), (field) =>
    printInputValueDefinition(field, context),
  );
}

function printScalarTypeDefinition(definition: ScalarTypeDefinitionNode, context: PrinterContext): string {
  return withDescription(
    definition.description,
    joinWords(['scalar', definition.name.value, printDirectives(definition.directives, context)]),
  );
}

function printFieldDefinition(field: FieldDefinitionNode, context: PrinterContext): string {
  let printed = field.name.value;
  if (field.arguments && field.arguments.length > 0) {
    printed += printWrappedArguments(
      sortedInputValues(field.arguments).map((arg) => printInputValueDefinition(arg, context)),
    );
  }
  printed += ': ' + printType(field.type);
  const directives = printDirectives(field.directives, context);
  if (directives) {
    printed += ' ' + directives;
  }
  return withDescription(field.description, printed);
}

function printInputValueDefinition(arg: InputValueDefinitionNode, context: PrinterContext): string {
  let printed = arg.name.value + ': ' + printType(arg.type);
  if (arg.defaultValue !== undefined) {
    const type = typeFromNode(arg.type);
    const defaultValue = printAstFromValue(valueFromAst(arg.defaultValue, type, context), type, context);
    if (defaultValue) {
      printed += ' = ' + defaultValue;
    }
  }
  const directives = printDirectives(arg.directives, context);
  if (directives) {
    printed += ' ' + directives;
  }
  return withDescription(arg.description, printed);
}

function printDirectives(directives: ReadonlyArray<DirectiveNode> | undefined, context: PrinterContext): string {
  if (!directives || directives.length === 0) {
    return '';
  }
  if (directives.length === 1) {
    return printDirective(directives[0], context);
  }
  const directiveFlags = getDirectiveFlags(directives);
  const hasDuplicateDirectiveName = (directiveFlags & DIRECTIVE_FLAG_DUPLICATE) !== 0;
  const hasSpecifiedDirectiveName = (directiveFlags & DIRECTIVE_FLAG_SPECIFIED) !== 0;
  if (!hasDuplicateDirectiveName && !hasSpecifiedDirectiveName) {
    return printDirectiveList(directives, context, false);
  }
  const orderedDirectives = getReferenceOrderedDirectives(directives, hasDuplicateDirectiveName);
  if (orderedDirectives.length === 0) {
    return '';
  }
  return printDirectiveList(orderedDirectives, context, hasDuplicateDirectiveName);
}

function printDirectiveList(
  directives: ReadonlyArray<DirectiveNode>,
  context: PrinterContext,
  deduplicate: boolean,
): string {
  let printed = '';
  let seenDirectives: Set<string> | undefined;
  if (deduplicate) {
    seenDirectives = new Set<string>();
  }
  for (const directive of directives) {
    const printedDirective = printDirective(directive, context);
    if (seenDirectives) {
      if (seenDirectives.has(printedDirective)) {
        continue;
      }
      seenDirectives.add(printedDirective);
    }
    printed += printed ? ' ' + printedDirective : printedDirective;
  }
  return printed;
}

const DIRECTIVE_FLAG_DUPLICATE = 1;
const DIRECTIVE_FLAG_SPECIFIED = 2;

function getReferenceOrderedDirectives(
  directives: ReadonlyArray<DirectiveNode>,
  hasDuplicateDirectiveName: boolean,
): Array<DirectiveNode> {
  const groupedDirectives = hasDuplicateDirectiveName ? groupRepeatableDirectives(directives) : directives;
  let deprecatedDirective: DirectiveNode | undefined;
  let specifiedByDirective: DirectiveNode | undefined;
  let oneOfDirective: DirectiveNode | undefined;
  const orderedDirectives: Array<DirectiveNode> = [];
  for (const directive of groupedDirectives) {
    switch (directive.name.value) {
      case 'deprecated':
        deprecatedDirective ??= directive;
        break;
      case 'specifiedBy':
        specifiedByDirective ??= directive;
        break;
      case 'oneOf':
        oneOfDirective ??= directive;
        break;
      case 'include':
      case 'skip':
        break;
      default:
        orderedDirectives.push(directive);
    }
  }
  if (deprecatedDirective) {
    orderedDirectives.push(deprecatedDirective);
  }
  if (specifiedByDirective) {
    orderedDirectives.push(specifiedByDirective);
  }
  if (oneOfDirective) {
    orderedDirectives.push(oneOfDirective);
  }
  return orderedDirectives;
}

function groupRepeatableDirectives(directives: ReadonlyArray<DirectiveNode>): Array<DirectiveNode> {
  const groupedDirectives: Array<DirectiveNode> = [];
  const directiveNodesByName = new Map<string, Array<DirectiveNode>>();
  for (const directive of directives) {
    let nodes = directiveNodesByName.get(directive.name.value);
    if (!nodes) {
      nodes = [];
      directiveNodesByName.set(directive.name.value, nodes);
    }
    nodes.push(directive);
  }
  for (const nodes of directiveNodesByName.values()) {
    groupedDirectives.push(...nodes);
  }
  return groupedDirectives;
}

function getDirectiveFlags(directives: ReadonlyArray<DirectiveNode>): number {
  if (directives.length === 2) {
    let flags = directives[0].name.value === directives[1].name.value ? DIRECTIVE_FLAG_DUPLICATE : 0;
    if (isSpecifiedDirectiveName(directives[0].name.value) || isSpecifiedDirectiveName(directives[1].name.value)) {
      flags |= DIRECTIVE_FLAG_SPECIFIED;
    }
    return flags;
  }
  let flags = 0;
  const seenDirectiveNames = new Set<string>();
  for (const directive of directives) {
    if (seenDirectiveNames.has(directive.name.value)) {
      flags |= DIRECTIVE_FLAG_DUPLICATE;
    }
    if (isSpecifiedDirectiveName(directive.name.value)) {
      flags |= DIRECTIVE_FLAG_SPECIFIED;
    }
    seenDirectiveNames.add(directive.name.value);
  }
  return flags;
}

function isSpecifiedDirectiveName(name: string): boolean {
  switch (name) {
    case 'deprecated':
    case 'specifiedBy':
    case 'oneOf':
    case 'include':
    case 'skip':
      return true;
    default:
      return false;
  }
}

function printDirective(directive: DirectiveNode, context: PrinterContext): string {
  const directiveInfo = context.directives.get(directive.name.value);
  const argNodes = directive.arguments ?? [];
  if (argNodes.length === 0) {
    return '@' + directive.name.value;
  }
  let args = printDirectiveArgument(argNodes[0], directiveInfo, context);
  for (let i = 1; i < argNodes.length; i++) {
    args += ', ' + printDirectiveArgument(argNodes[i], directiveInfo, context);
  }
  return '@' + directive.name.value + '(' + args + ')';
}

function printDirectiveArgument(
  arg: NonNullable<DirectiveNode['arguments']>[number],
  directiveInfo: DirectiveInfo | undefined,
  context: PrinterContext,
): string {
  if (!directiveInfo) {
    return arg.name.value + ': ' + printValueNode(arg.value as ConstValueNode);
  }
  const argInfo = directiveInfo.argByName.get(arg.name.value);
  return (
    arg.name.value +
    ': ' +
    (argInfo
      ? printDirectiveArgumentValue(arg.value as ConstValueNode, argInfo.type, context)
      : printValueNode(arg.value as ConstValueNode))
  );
}

function printDirectiveArgumentValue(valueNode: ConstValueNode, type: TypeRef, context: PrinterContext): string {
  if (valueNode.kind === KindRef.NULL) {
    return 'null';
  }
  const nullableType = type.kind === KindRef.NON_NULL_TYPE ? type.type : type;
  if (nullableType.kind !== KindRef.NAMED_TYPE) {
    return printAstFromValue(valueFromUntypedAst(valueNode), type, context);
  }
  const namedType = context.types.get(nullableType.name) ?? { kind: 'scalar', name: nullableType.name };
  if (namedType.kind === 'input') {
    return printAstFromValue(valueFromUntypedAst(valueNode), type, context);
  }
  if (namedType.kind === 'enum') {
    if (valueNode.kind === KindRef.ENUM) {
      if (!namedType.values.has(valueNode.value)) {
        throw new TypeError('Enum "' + namedType.name + '" cannot represent value: "' + valueNode.value + '"');
      }
      return valueNode.value;
    }
    return printAstFromValue(valueFromUntypedAst(valueNode), type, context);
  }
  switch (namedType.name) {
    case 'Int':
      return valueNode.kind === KindRef.INT
        ? String(Number(valueNode.value))
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
    case 'Float':
      return valueNode.kind === KindRef.INT || valueNode.kind === KindRef.FLOAT
        ? printUntypedValue(Number(valueNode.value))
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
    case 'Boolean':
      return valueNode.kind === KindRef.BOOLEAN
        ? valueNode.value
          ? 'true'
          : 'false'
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
    case 'ID':
      if (valueNode.kind === KindRef.INT) {
        return valueNode.value;
      }
      return valueNode.kind === KindRef.STRING
        ? printString(valueNode.value)
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
    case 'String':
      return valueNode.kind === KindRef.STRING
        ? printString(valueNode.value)
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
    default:
      return valueNode.kind === KindRef.STRING
        ? printString(valueNode.value)
        : printAstFromValue(valueFromUntypedAst(valueNode), type, context);
  }
}

function valueFromAst(valueNode: ConstValueNode | undefined, type: TypeRef, context: PrinterContext): unknown {
  if (!valueNode) {
    return undefined;
  }
  if (type.kind === KindRef.NON_NULL_TYPE) {
    if (valueNode.kind === KindRef.NULL) {
      return undefined;
    }
    return valueFromAst(valueNode, type.type, context);
  }
  if (valueNode.kind === KindRef.NULL) {
    return null;
  }
  if (type.kind === KindRef.LIST_TYPE) {
    if (valueNode.kind === KindRef.LIST) {
      const values: Array<unknown> = [];
      for (const item of valueNode.values) {
        const value = valueFromAst(item, type.type, context);
        if (value === undefined) {
          return undefined;
        }
        values.push(value);
      }
      return values;
    }
    const value = valueFromAst(valueNode, type.type, context);
    return value === undefined ? undefined : [value];
  }
  const namedType = context.types.get(type.name) ?? { kind: 'scalar', name: type.name };
  switch (namedType.kind) {
    case 'input':
      return valueFromInputObjectAst(valueNode, namedType, context);
    case 'enum':
      return valueNode.kind === KindRef.ENUM && namedType.values.has(valueNode.value) ? valueNode.value : undefined;
    default:
      return valueFromScalarAst(valueNode, namedType.name);
  }
}

function valueFromInputObjectAst(
  valueNode: ConstValueNode,
  inputType: Extract<NamedTypeInfo, { kind: 'input' }>,
  context: PrinterContext,
): unknown {
  if (valueNode.kind !== KindRef.OBJECT) {
    return undefined;
  }
  const fieldsByName = new Map<string, ConstValueNode>();
  for (const field of valueNode.fields) {
    fieldsByName.set(field.name.value, field.value);
  }
  const value: Record<string, unknown> = Object.create(null);
  for (const field of getInputFields(inputType)) {
    const fieldValueNode = fieldsByName.get(field.name);
    if (fieldValueNode === undefined) {
      if (field.defaultValue !== undefined) {
        const defaultValue = valueFromAst(field.defaultValue, field.type, context);
        if (defaultValue !== undefined) {
          value[field.name] = defaultValue;
        }
      }
      continue;
    }
    const fieldValue = valueFromAst(fieldValueNode, field.type, context);
    if (fieldValue === undefined) {
      return undefined;
    }
    value[field.name] = fieldValue;
  }
  if (inputType.oneOf) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || value[keys[0]] === null) {
      return undefined;
    }
  }
  return value;
}

function valueFromScalarAst(valueNode: ConstValueNode, typeName: string): unknown {
  switch (typeName) {
    case 'Int':
      return valueNode.kind === KindRef.INT ? Number(valueNode.value) : undefined;
    case 'Float':
      return valueNode.kind === KindRef.INT || valueNode.kind === KindRef.FLOAT ? Number(valueNode.value) : undefined;
    case 'String':
      return valueNode.kind === KindRef.STRING ? valueNode.value : undefined;
    case 'Boolean':
      return valueNode.kind === KindRef.BOOLEAN ? valueNode.value : undefined;
    case 'ID':
      return valueNode.kind === KindRef.STRING || valueNode.kind === KindRef.INT ? valueNode.value : undefined;
    default:
      return valueFromUntypedAst(valueNode);
  }
}

function valueFromUntypedAst(valueNode: ConstValueNode): unknown {
  switch (valueNode.kind) {
    case KindRef.INT:
    case KindRef.FLOAT:
      return Number(valueNode.value);
    case KindRef.STRING:
    case KindRef.ENUM:
      return valueNode.value;
    case KindRef.BOOLEAN:
      return valueNode.value;
    case KindRef.NULL:
      return null;
    case KindRef.LIST:
      return valueNode.values.map(valueFromUntypedAst);
    case KindRef.OBJECT: {
      const value: Record<string, unknown> = Object.create(null);
      for (const field of valueNode.fields) {
        value[field.name.value] = valueFromUntypedAst(field.value);
      }
      return value;
    }
  }
}

function printAstFromValue(value: unknown, type: TypeRef, context: PrinterContext): string {
  if (type.kind === KindRef.NON_NULL_TYPE) {
    if (value === null) {
      return '';
    }
    return printAstFromValue(value, type.type, context);
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (type.kind === KindRef.LIST_TYPE) {
    if (Array.isArray(value)) {
      return (
        '[' +
        value
          .map((item) => printAstFromValue(item, type.type, context))
          .filter(Boolean)
          .join(', ') +
        ']'
      );
    }
    return printAstFromValue(value, type.type, context);
  }
  const namedType = context.types.get(type.name) ?? { kind: 'scalar', name: type.name };
  switch (namedType.kind) {
    case 'input':
      return printInputObjectValue(value, namedType, context);
    case 'enum':
      if (typeof value !== 'string') {
        return '';
      }
      if (!namedType.values.has(value)) {
        throw new TypeError('Enum "' + namedType.name + '" cannot represent value: "' + value + '"');
      }
      return value;
    default:
      return printScalarValue(value, namedType.name);
  }
}

function printInputObjectValue(
  value: unknown,
  inputType: Extract<NamedTypeInfo, { kind: 'input' }>,
  context: PrinterContext,
): string {
  if (value === null || typeof value !== 'object') {
    return '';
  }
  const objectValue = value as Record<string, unknown>;
  const fields: Array<string> = [];
  for (const field of getInputFields(inputType)) {
    if (!(field.name in objectValue)) {
      continue;
    }
    const fieldValue = printAstFromValue(objectValue[field.name], field.type, context);
    if (fieldValue) {
      fields.push(field.name + ': ' + fieldValue);
    }
  }
  return '{' + fields.join(', ') + '}';
}

function getInputFields(inputType: Extract<NamedTypeInfo, { kind: 'input' }>): Array<InputFieldInfo> {
  let fields = inputType.fields;
  if (!fields) {
    fields = sortedInputValues(inputType.node.fields).map(toInputFieldInfo);
    inputType.fields = fields;
  }
  return fields;
}

function printScalarValue(value: unknown, typeName: string): string {
  switch (typeName) {
    case 'Int':
      return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '';
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value) ? printUntypedValue(value) : '';
    case 'String':
      return typeof value === 'string' ? printString(value) : '';
    case 'Boolean':
      return typeof value === 'boolean' ? (value ? 'true' : 'false') : '';
    case 'ID':
      if (typeof value !== 'string') {
        return '';
      }
      return INT_REGEXP.test(value) ? value : printString(value);
    default:
      return printUntypedValue(value);
  }
}

function printUntypedValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(printUntypedValue).filter(Boolean).join(', ') + ']';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return String(value);
    case 'number':
      if (!Number.isFinite(value)) {
        return '';
      }
      return String(value);
    case 'object': {
      if (!value) {
        return '';
      }
      const fields: Array<string> = [];
      for (const fieldName in value) {
        const fieldValue = printUntypedValue((value as Record<string, unknown>)[fieldName]);
        if (fieldValue) {
          fields.push(fieldName + ': ' + fieldValue);
        }
      }
      return '{' + fields.join(', ') + '}';
    }
    case 'string':
      return printString(value);
    default:
      return '';
  }
}

function printValueNode(valueNode: ConstValueNode): string {
  switch (valueNode.kind) {
    case KindRef.INT:
    case KindRef.FLOAT:
    case KindRef.ENUM:
      return valueNode.value;
    case KindRef.STRING:
      return valueNode.block ? printBlockString(valueNode.value) : printString(valueNode.value);
    case KindRef.BOOLEAN:
      return valueNode.value ? 'true' : 'false';
    case KindRef.NULL:
      return 'null';
    case KindRef.LIST:
      return '[' + valueNode.values.map(printValueNode).join(', ') + ']';
    case KindRef.OBJECT:
      return (
        '{' + valueNode.fields.map((field) => field.name.value + ': ' + printValueNode(field.value)).join(', ') + '}'
      );
  }
}

function printType(typeNode: TypeNode): string {
  switch (typeNode.kind) {
    case KindRef.NAMED_TYPE:
      return typeNode.name.value;
    case KindRef.LIST_TYPE:
      return '[' + printType(typeNode.type) + ']';
    case KindRef.NON_NULL_TYPE:
      return printType(typeNode.type) + '!';
  }
}

function typeFromNode(typeNode: TypeNode): TypeRef {
  switch (typeNode.kind) {
    case KindRef.NAMED_TYPE:
      return namedRef(typeNode.name.value);
    case KindRef.LIST_TYPE:
      return { kind: KindRef.LIST_TYPE, type: typeFromNode(typeNode.type) };
    case KindRef.NON_NULL_TYPE:
      return { kind: KindRef.NON_NULL_TYPE, type: typeFromNode(typeNode.type) };
  }
}

function namedRef(name: string): TypeRef {
  return { kind: KindRef.NAMED_TYPE, name };
}

function nonNullRef(type: TypeRef): TypeRef {
  return { kind: KindRef.NON_NULL_TYPE, type };
}

function toInputFieldInfo(field: InputValueDefinitionNode): InputFieldInfo {
  return {
    defaultValue: field.defaultValue,
    name: field.name.value,
    type: typeFromNode(field.type),
  };
}

function printWrappedArguments(args: Array<string>): string {
  if (args.length === 0) {
    return '';
  }
  if (args.some((arg) => arg.includes('\n'))) {
    return '(\n' + indent(args.join('\n')) + '\n)';
  }
  return '(' + args.join(', ') + ')';
}

function printDescribedNodesBlock<T>(
  description: StringValueNode | undefined,
  head: string,
  items: Array<T>,
  printItem: (item: T) => string,
): string {
  if (items.length === 0) {
    return withDescription(description, head);
  }
  let body = printItem(items[0]);
  for (let i = 1; i < items.length; i++) {
    body += ' ' + printItem(items[i]);
  }
  return withDescription(description, head + ' { ' + body + ' }');
}

function withDescription(description: StringValueNode | undefined, value: string): string {
  return description ? printDescription(description) + '\n' + value : value;
}

function printDescription(description: StringValueNode): string {
  return printBlockString(description.value);
}

function printImplementedInterfaces(interfaces: ReadonlyArray<NamedTypeNode> | undefined): string {
  const sortedInterfaces = sortedNamedTypes(interfaces);
  return sortedInterfaces.length > 0 ? 'implements ' + sortedInterfaces.map((type) => type.name.value).join(' & ') : '';
}

function sortedFieldDefinitions(fields: ReadonlyArray<FieldDefinitionNode> | undefined): Array<FieldDefinitionNode> {
  return sortByName(fields);
}

function sortedInputValues(
  values: ReadonlyArray<InputValueDefinitionNode> | undefined,
): Array<InputValueDefinitionNode> {
  return sortByName(values);
}

function sortedEnumValues(values: ReadonlyArray<EnumValueDefinitionNode> | undefined): Array<EnumValueDefinitionNode> {
  return sortByName(values);
}

function sortedNamedTypes(types: ReadonlyArray<NamedTypeNode> | undefined): Array<NamedTypeNode> {
  return sortByName(types);
}

function sortedNameNodes<T extends { value: string }>(nodes: ReadonlyArray<T> | undefined): Array<T> {
  if (!nodes || nodes.length === 0) {
    return [];
  }
  if (nodes.length === 1) {
    return [nodes[0]];
  }
  const sorted = nodes.slice();
  return sorted.sort(hasDigitValue(nodes) ? compareByValueNatural : compareByValueLexical);
}

function sortByName<T extends { name: { value: string } }>(nodes: ReadonlyArray<T> | undefined): Array<T> {
  if (!nodes || nodes.length === 0) {
    return [];
  }
  if (nodes.length === 1) {
    return [nodes[0]];
  }
  const sorted = nodes.slice();
  return sorted.sort(hasDigitName(nodes) ? compareByNameNatural : compareByNameLexical);
}

function compareByNameNatural<T extends { name: { value: string } }>(a: T, b: T): number {
  return naturalCompare(a.name.value, b.name.value);
}

function compareByNameLexical<T extends { name: { value: string } }>(a: T, b: T): number {
  return a.name.value < b.name.value ? -1 : a.name.value > b.name.value ? 1 : 0;
}

function compareByValueNatural<T extends { value: string }>(a: T, b: T): number {
  return naturalCompare(a.value, b.value);
}

function compareByValueLexical<T extends { value: string }>(a: T, b: T): number {
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

function hasDigitName<T extends { name: { value: string } }>(nodes: ReadonlyArray<T>): boolean {
  for (const node of nodes) {
    if (containsDigit(node.name.value)) {
      return true;
    }
  }
  return false;
}

function hasDigitValue<T extends { value: string }>(nodes: ReadonlyArray<T>): boolean {
  for (const node of nodes) {
    if (containsDigit(node.value)) {
      return true;
    }
  }
  return false;
}

function containsDigit(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      return true;
    }
  }
  return false;
}

function joinWords(parts: Array<string>): string {
  let output = '';
  for (const part of parts) {
    if (!part) {
      continue;
    }
    output += output ? ' ' + part : part;
  }
  return output;
}

function wrap(start: string, value: string, end = ''): string {
  return value ? start + value + end : '';
}

function indent(value: string): string {
  return '  ' + value.replace(/\n/g, '\n  ');
}

function hasDirective(directives: ReadonlyArray<DirectiveNode> | undefined, name: string): boolean {
  return Boolean(directives?.some((directive) => directive.name.value === name));
}

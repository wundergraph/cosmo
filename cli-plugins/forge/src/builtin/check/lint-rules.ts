import { Kind } from 'graphql';
import type {
  ASTNode,
  ConstDirectiveNode,
  DefinitionNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
} from 'graphql';

/** A violation before it is given a severity and a file. */
export interface Violation {
  coordinate: string;
  message: string;
  node: ASTNode;
}

export interface LintRule {
  /** The rule IDs are the ones Cosmo's schema lint uses, so a policy reads the same in both. */
  id: string;
  defaultSeverity: 'error' | 'warn' | 'off';
  check(document: DocumentNode): Violation[];
}

type TypeKind = 'object' | 'interface' | 'input' | 'enum' | 'union' | 'scalar';

interface TypeEntry {
  kind: TypeKind;
  name: string;
  node: DefinitionNode;
  /** False for `extend type`, whose name is checked where the type is defined. */
  isDefinition: boolean;
  described: boolean;
  fields: readonly (FieldDefinitionNode | InputValueDefinitionNode)[];
  values: readonly EnumValueDefinitionNode[];
}

const typeKinds: Partial<Record<Kind, { kind: TypeKind; isDefinition: boolean }>> = {
  [Kind.OBJECT_TYPE_DEFINITION]: { kind: 'object', isDefinition: true },
  [Kind.OBJECT_TYPE_EXTENSION]: { kind: 'object', isDefinition: false },
  [Kind.INTERFACE_TYPE_DEFINITION]: { kind: 'interface', isDefinition: true },
  [Kind.INTERFACE_TYPE_EXTENSION]: { kind: 'interface', isDefinition: false },
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: { kind: 'input', isDefinition: true },
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: { kind: 'input', isDefinition: false },
  [Kind.ENUM_TYPE_DEFINITION]: { kind: 'enum', isDefinition: true },
  [Kind.ENUM_TYPE_EXTENSION]: { kind: 'enum', isDefinition: false },
  [Kind.UNION_TYPE_DEFINITION]: { kind: 'union', isDefinition: true },
  [Kind.SCALAR_TYPE_DEFINITION]: { kind: 'scalar', isDefinition: true },
};

const typeEntries = (document: DocumentNode): TypeEntry[] => {
  const entries: TypeEntry[] = [];

  for (const node of document.definitions) {
    const classified = typeKinds[node.kind];
    if (classified === undefined || !('name' in node) || node.name === undefined) {
      continue;
    }

    entries.push({
      ...classified,
      name: node.name.value,
      node,
      described: 'description' in node && node.description !== undefined,
      fields: 'fields' in node ? (node.fields ?? []) : [],
      values: 'values' in node ? (node.values ?? []) : [],
    });
  }

  return entries;
};

const withoutLeadingUnderscores = (name: string): string => name.replace(/^_+/, '');

const camelCase = /^[a-z][\dA-Za-z]*$/;
const pascalCase = /^[A-Z][\dA-Za-z]*$/;
const upperCase = /^[A-Z][\dA-Z]*(_[\dA-Z]+)*$/;

// Types the router defines for event-driven subgraphs, which Cosmo's lint leaves alone as well.
const reservedTypeNames = new Set(['edfs__PublishResult']);
const reservedInputNames = new Set([
  'cosmoStreams__DeliveryGuarantees',
  'edfs__NatsStreamConfiguration',
  'openfed__SubscriptionFieldCondition',
  'openfed__SubscriptionFilterCondition',
]);

const kindLabels: Record<TypeKind, string> = {
  object: 'Type',
  interface: 'Interface',
  input: 'Input',
  enum: 'Enum',
  union: 'Union',
  scalar: 'Scalar',
};

/** A rule about the names of one kind of type definition. */
const typeNameRule = (
  id: string,
  kind: TypeKind,
  problemWith: (name: string) => string | undefined,
  reserved = new Set<string>(),
): LintRule => ({
  id,
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];

    for (const entry of typeEntries(document)) {
      if (entry.kind !== kind || !entry.isDefinition || reserved.has(entry.name)) {
        continue;
      }

      const problem = problemWith(withoutLeadingUnderscores(entry.name));
      if (problem !== undefined) {
        violations.push({
          coordinate: entry.name,
          message: `${kindLabels[kind]} "${entry.name}" ${problem}.`,
          node: entry.node,
        });
      }
    }

    return violations;
  },
});

const mustNotStartWith =
  (prefixes: string[]) =>
  (name: string): string | undefined => {
    const prefix = prefixes.find((candidate) => name.startsWith(candidate));
    return prefix === undefined ? undefined : `should not have the prefix "${prefix}"`;
  };

const mustNotEndWith =
  (suffixes: string[]) =>
  (name: string): string | undefined => {
    const suffix = suffixes.find((candidate) => name.endsWith(candidate));
    return suffix === undefined ? undefined : `should not have the suffix "${suffix}"`;
  };

const fieldNamesShouldBeCamelCase: LintRule = {
  id: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];

    for (const entry of typeEntries(document)) {
      if (entry.kind !== 'object' && entry.kind !== 'interface') {
        continue;
      }

      for (const field of entry.fields) {
        if (!camelCase.test(withoutLeadingUnderscores(field.name.value))) {
          violations.push({
            coordinate: `${entry.name}.${field.name.value}`,
            message: `Field "${field.name.value}" should be in camelCase.`,
            node: field,
          });
        }
      }
    }

    return violations;
  },
};

const enumValuesShouldBeUpperCase: LintRule = {
  id: 'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];

    for (const entry of typeEntries(document)) {
      for (const value of entry.values) {
        if (!upperCase.test(withoutLeadingUnderscores(value.name.value))) {
          violations.push({
            coordinate: `${entry.name}.${value.name.value}`,
            message: `Enum value "${value.name.value}" should be in UPPER_CASE.`,
            node: value,
          });
        }
      }
    }

    return violations;
  },
};

const disallowCaseInsensitiveEnumValues: LintRule = {
  id: 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];

    for (const entry of typeEntries(document)) {
      const seen = new Set<string>();
      for (const value of entry.values) {
        const folded = value.name.value.toLowerCase();
        if (seen.has(folded)) {
          violations.push({
            coordinate: `${entry.name}.${value.name.value}`,
            message: `Enum value "${value.name.value}" differs from another value of "${entry.name}" only by case.`,
            node: value,
          });
        }
        seen.add(folded);
      }
    }

    return violations;
  },
};

const noTypenamePrefixInTypeFields: LintRule = {
  id: 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS',
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];

    for (const entry of typeEntries(document)) {
      if (entry.kind !== 'object' && entry.kind !== 'interface') {
        continue;
      }

      for (const field of entry.fields) {
        if (field.name.value.toLowerCase().startsWith(entry.name.toLowerCase())) {
          violations.push({
            coordinate: `${entry.name}.${field.name.value}`,
            message: `Field "${field.name.value}" starts with the name of its type "${entry.name}".`,
            node: field,
          });
        }
      }
    }

    return violations;
  },
};

const deprecatedWithoutReason = (directives: readonly ConstDirectiveNode[] | undefined): boolean =>
  (directives ?? []).some((directive) => {
    if (directive.name.value !== 'deprecated') {
      return false;
    }

    const reason = directive.arguments?.find((argument) => argument.name.value === 'reason')?.value;
    return reason === undefined || reason.kind !== Kind.STRING || reason.value.trim() === '';
  });

const requireDeprecationReason: LintRule = {
  id: 'REQUIRE_DEPRECATION_REASON',
  defaultSeverity: 'warn',
  check(document) {
    const violations: Violation[] = [];
    const report = (coordinate: string, node: ASTNode): void => {
      violations.push({ coordinate, message: `The deprecation of "${coordinate}" has no reason.`, node });
    };

    for (const entry of typeEntries(document)) {
      for (const field of entry.fields) {
        const coordinate = `${entry.name}.${field.name.value}`;
        if (deprecatedWithoutReason(field.directives)) {
          report(coordinate, field);
        }

        const fieldArguments = field.kind === Kind.FIELD_DEFINITION ? (field.arguments ?? []) : [];
        for (const argument of fieldArguments) {
          if (deprecatedWithoutReason(argument.directives)) {
            report(`${coordinate}(${argument.name.value}:)`, argument);
          }
        }
      }

      for (const value of entry.values) {
        if (deprecatedWithoutReason(value.directives)) {
          report(`${entry.name}.${value.name.value}`, value);
        }
      }
    }

    return violations;
  },
};

const allTypesRequireDescription: LintRule = {
  id: 'ALL_TYPES_REQUIRE_DESCRIPTION',
  defaultSeverity: 'off',
  check(document) {
    return typeEntries(document)
      .filter((entry) => entry.isDefinition && !entry.described)
      .map((entry) => ({
        coordinate: entry.name,
        message: `${kindLabels[entry.kind]} "${entry.name}" has no description.`,
        node: entry.node,
      }));
  },
};

interface Named {
  name: string;
  coordinate: string;
  node: ASTNode;
}

/** Every item that sorts before the one in front of it. */
const outOfOrder = (items: Named[]): Violation[] => {
  const violations: Violation[] = [];

  for (const [index, item] of items.entries()) {
    const previous = items[index - 1];
    if (previous !== undefined && item.name.localeCompare(previous.name) < 0) {
      violations.push({
        coordinate: item.coordinate,
        message: `"${item.name}" should be before "${previous.name}".`,
        node: item.node,
      });
    }
  }

  return violations;
};

const orderFields: LintRule = {
  id: 'ORDER_FIELDS',
  defaultSeverity: 'off',
  check(document) {
    return typeEntries(document).flatMap((entry) =>
      outOfOrder(
        entry.fields.map((field) => ({
          name: field.name.value,
          coordinate: `${entry.name}.${field.name.value}`,
          node: field,
        })),
      ),
    );
  },
};

const orderEnumValues: LintRule = {
  id: 'ORDER_ENUM_VALUES',
  defaultSeverity: 'off',
  check(document) {
    return typeEntries(document).flatMap((entry) =>
      outOfOrder(
        entry.values.map((value) => ({
          name: value.name.value,
          coordinate: `${entry.name}.${value.name.value}`,
          node: value,
        })),
      ),
    );
  },
};

const orderDefinitions: LintRule = {
  id: 'ORDER_DEFINITIONS',
  defaultSeverity: 'off',
  check(document) {
    return outOfOrder(
      typeEntries(document).map((entry) => ({ name: entry.name, coordinate: entry.name, node: entry.node })),
    );
  },
};

export const lintRules: LintRule[] = [
  fieldNamesShouldBeCamelCase,
  typeNameRule(
    'TYPE_NAMES_SHOULD_BE_PASCAL_CASE',
    'object',
    (name) => (pascalCase.test(name) ? undefined : 'should be in PascalCase'),
    reservedTypeNames,
  ),
  typeNameRule('SHOULD_NOT_HAVE_TYPE_PREFIX', 'object', mustNotStartWith(['Type', 'type'])),
  typeNameRule('SHOULD_NOT_HAVE_TYPE_SUFFIX', 'object', mustNotEndWith(['Type', 'type'])),
  typeNameRule('SHOULD_NOT_HAVE_INPUT_PREFIX', 'input', mustNotStartWith(['Input', 'input'])),
  typeNameRule(
    'SHOULD_HAVE_INPUT_SUFFIX',
    'input',
    (name) => (name.endsWith('Input') ? undefined : 'should have the suffix "Input"'),
    reservedInputNames,
  ),
  typeNameRule('SHOULD_NOT_HAVE_ENUM_PREFIX', 'enum', mustNotStartWith(['Enum', 'enum', 'ENUM'])),
  typeNameRule('SHOULD_NOT_HAVE_ENUM_SUFFIX', 'enum', mustNotEndWith(['Enum', 'enum'])),
  typeNameRule('SHOULD_NOT_HAVE_INTERFACE_PREFIX', 'interface', mustNotStartWith(['Interface', 'interface'])),
  typeNameRule('SHOULD_NOT_HAVE_INTERFACE_SUFFIX', 'interface', mustNotEndWith(['Interface', 'interface'])),
  enumValuesShouldBeUpperCase,
  disallowCaseInsensitiveEnumValues,
  noTypenamePrefixInTypeFields,
  requireDeprecationReason,
  allTypesRequireDescription,
  orderFields,
  orderEnumValues,
  orderDefinitions,
];

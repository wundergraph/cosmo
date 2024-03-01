import { Linter } from 'eslint';
import { parseForESLint, rules } from '@graphql-eslint/eslint-plugin';
import { LintIssueResult, LintRuleType, RulesConfig, SchemaLintDTO, SchemaLintIssues } from 'src/types/index.js';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

const getRuleName = (rule: LintRuleType): string => {
  switch (rule) {
    case 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE':
    case 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE':
    case 'SHOULD_NOT_HAVE_TYPE_PREFIX':
    case 'SHOULD_NOT_HAVE_TYPE_SUFFIX':
    case 'SHOULD_NOT_HAVE_INPUT_PREFIX':
    case 'SHOULD_HAVE_INPUT_SUFFIX':
    case 'SHOULD_NOT_HAVE_ENUM_PREFIX':
    case 'SHOULD_NOT_HAVE_ENUM_SUFFIX':
    case 'SHOULD_NOT_HAVE_INTERFACE_PREFIX':
    case 'SHOULD_NOT_HAVE_INTERFACE_SUFFIX':
    case 'ENUM_VALUES_SHOULD_BE_UPPER_CASE': {
      return 'naming-convention';
    }
    case 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES': {
      return 'no-case-insensitive-enum-values-duplicates';
    }
    case 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS': {
      return 'no-typename-prefix';
    }
    case 'ORDER_FIELDS':
    case 'ORDER_ENUM_VALUES':
    case 'ORDER_DEFINITIONS': {
      return 'alphabetize';
    }
    case 'ALL_TYPES_REQUIRE_DESCRIPTION':
    case 'ROOT_FIELDS_REQUIRE_DESCRIPTION': {
      return 'require-description';
    }
    case 'REQUIRE_DEPRECATION_REASON': {
      return 'require-deprecation-reason';
    }
    case 'REQUIRE_DEPRECATION_DATE': {
      return 'require-deprecation-date';
    }
    case 'UNIQUE_ENUM_VALUES': {
      return 'unique-enum-value-names';
    }
    case 'UNIQUE_TYPE_NAMES': {
      return 'unique-type-names';
    }
    default: {
      throw new Error(`Rule ${rule} doesnt exist`);
    }
  }
};

export const createRulesConfig = (rules: SchemaLintDTO[]) => {
  const rulesConfig: RulesConfig = {};
  for (const rule of rules) {
    switch (rule.ruleName) {
      case 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            FieldDefinition: { style: 'camelCase' },
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { FieldDefinition: { style: 'camelCase' } }];
        }
        break;
      }
      case 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('ObjectTypeDefinition' in ruleOptions) {
            const objectTypeConfig = ruleOptions.ObjectTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { ...objectTypeConfig, style: 'PascalCase' },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { style: 'PascalCase' },
            };
          }
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { ObjectTypeDefinition: { style: 'PascalCase' } }];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_TYPE_PREFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('ObjectTypeDefinition' in ruleOptions) {
            const objectTypeConfig = ruleOptions.ObjectTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { ...objectTypeConfig, forbiddenPrefixes: ['Type', 'type'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { forbiddenPrefixes: ['Type', 'type'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { ObjectTypeDefinition: { forbiddenPrefixes: ['Type', 'type'] } }];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_TYPE_SUFFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('ObjectTypeDefinition' in ruleOptions) {
            const objectTypeConfig = ruleOptions.ObjectTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { ...objectTypeConfig, forbiddenSuffixes: ['Type', 'type'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              ObjectTypeDefinition: { forbiddenSuffixes: ['Type', 'type'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { ObjectTypeDefinition: { forbiddenSuffixes: ['Type', 'type'] } }];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_INPUT_PREFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('InputObjectTypeDefinition' in ruleOptions) {
            const inputObjectTypeConfig = ruleOptions.InputObjectTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              InputObjectTypeDefinition: { ...inputObjectTypeConfig, forbiddenPrefixes: ['Input', 'input'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              InputObjectTypeDefinition: { forbiddenPrefixes: ['Input', 'input'] },
            };
          }

          ruleConfig[1] = ruleOptions;
          break;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { InputObjectTypeDefinition: { forbiddenPrefixes: ['Input', 'input'] } },
          ];
        }
        break;
      }
      case 'SHOULD_HAVE_INPUT_SUFFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('InputObjectTypeDefinition' in ruleOptions) {
            const inputObjectTypeConfig = ruleOptions.InputObjectTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              InputObjectTypeDefinition: { ...inputObjectTypeConfig, requiredSuffixes: ['Input', 'input'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              InputObjectTypeDefinition: { requiredSuffixes: ['Input', 'input'] },
            };
          }

          ruleConfig[1] = ruleOptions;
          break;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { InputObjectTypeDefinition: { requiredSuffixes: ['Input', 'input'] } },
          ];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_ENUM_PREFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('EnumTypeDefinition' in ruleOptions) {
            const enumTypeConfig = ruleOptions.EnumTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              EnumTypeDefinition: { ...enumTypeConfig, forbiddenPrefixes: ['Enum', 'enum', 'ENUM'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              EnumTypeDefinition: { forbiddenPrefixes: ['Enum', 'enum', 'ENUM'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { EnumTypeDefinition: { forbiddenPrefixes: ['Enum', 'enum', 'ENUM'] } },
          ];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_ENUM_SUFFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('EnumTypeDefinition' in ruleOptions) {
            const enumTypeConfig = ruleOptions.EnumTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              EnumTypeDefinition: { ...enumTypeConfig, forbiddenSuffixes: ['Enum', 'enum'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              EnumTypeDefinition: { forbiddenSuffixes: ['Enum', 'enum'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { EnumTypeDefinition: { forbiddenSuffixes: ['Enum', 'enum'] } }];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_INTERFACE_PREFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('InterfaceTypeDefinition' in ruleOptions) {
            const interfaceTypeConfig = ruleOptions.InterfaceTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              InterfaceTypeDefinition: { ...interfaceTypeConfig, forbiddenPrefixes: ['Interface', 'interface'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              InterfaceTypeDefinition: { forbiddenPrefixes: ['Interface', 'interface'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { InterfaceTypeDefinition: { forbiddenPrefixes: ['Interface', 'interface'] } },
          ];
        }
        break;
      }
      case 'SHOULD_NOT_HAVE_INTERFACE_SUFFIX': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('InterfaceTypeDefinition' in ruleOptions) {
            const interfaceTypeConfig = ruleOptions.InterfaceTypeDefinition;
            ruleOptions = {
              ...ruleOptions,
              InterfaceTypeDefinition: { ...interfaceTypeConfig, forbiddenSuffixes: ['Interface', 'interface'] },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              InterfaceTypeDefinition: { forbiddenSuffixes: ['Interface', 'interface'] },
            };
          }

          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { InterfaceTypeDefinition: { forbiddenSuffixes: ['Interface', 'interface'] } },
          ];
        }
        break;
      }
      case 'ENUM_VALUES_SHOULD_BE_UPPER_CASE': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          if ('EnumValueDefinition' in ruleOptions) {
            const enumValueDefinition = ruleOptions.EnumValueDefinition;
            ruleOptions = {
              ...ruleOptions,
              EnumValueDefinition: { ...enumValueDefinition, style: 'UPPER_CASE' },
            };
          } else {
            ruleOptions = {
              ...ruleOptions,
              EnumValueDefinition: { style: 'UPPER_CASE' },
            };
          }

          ruleConfig[1] = ruleOptions;
          break;
        } else {
          rulesConfig[ruleName] = [rule.severity, { EnumValueDefinition: { style: 'UPPER_CASE' } }];
        }
        break;
      }
      case 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES':
      case 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS':
      case 'REQUIRE_DEPRECATION_REASON':
      case 'REQUIRE_DEPRECATION_DATE':
      case 'UNIQUE_ENUM_VALUES':
      case 'UNIQUE_TYPE_NAMES': {
        const ruleName = getRuleName(rule.ruleName);
        rulesConfig[ruleName] = [rule.severity];
        break;
      }
      case 'ORDER_FIELDS': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            fields: ['ObjectTypeDefinition', 'InterfaceTypeDefinition', 'InputObjectTypeDefinition'],
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [
            rule.severity,
            { fields: ['ObjectTypeDefinition', 'InterfaceTypeDefinition', 'InputObjectTypeDefinition'] },
          ];
        }
        break;
      }
      case 'ORDER_ENUM_VALUES': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            values: ['EnumTypeDefinition'],
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { values: ['EnumTypeDefinition'] }];
        }
        break;
      }
      case 'ORDER_DEFINITIONS': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            definitions: true,
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { definitions: true }];
        }
        break;
      }
      case 'ALL_TYPES_REQUIRE_DESCRIPTION': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            types: true,
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { types: true }];
        }
        break;
      }
      case 'ROOT_FIELDS_REQUIRE_DESCRIPTION': {
        const ruleName = getRuleName(rule.ruleName);
        if (ruleName in rulesConfig) {
          const ruleConfig = rulesConfig[ruleName] as any[];
          let ruleOptions = ruleConfig[1];
          ruleOptions = {
            ...ruleOptions,
            rootField: true,
          };
          ruleConfig[1] = ruleOptions;
        } else {
          rulesConfig[ruleName] = [rule.severity, { rootField: true }];
        }
        break;
      }
      default: {
        throw new Error(`Rule ${rule} doesnt exist`);
      }
    }
  }
  return rulesConfig;
};

const directiveDefinitions = `
directive @tag(
  name: String!
) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
directive @requiresScopes(scopes: [[String!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
directive @deprecated(reason: String) on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
directive @extends on INTERFACE | OBJECT
directive @external on FIELD_DEFINITION | OBJECT
directive @key(fields: String!) repeatable on OBJECT
directive @provides(fields: String!) on FIELD_DEFINITION
directive @requires(fields: String!) on FIELD_DEFINITION
directive @override(from: String!) on FIELD_DEFINITION

`;

export const schemaLintCheck = ({
  schema,
  rulesInput,
}: {
  schema: string;
  rulesInput: SchemaLintDTO[];
}): SchemaLintIssues => {
  const rulesConfig: RulesConfig = createRulesConfig(rulesInput);

  const linter = new Linter();
  linter.defineParser('@graphql-eslint/eslint-plugin', { parseForESLint });

  for (const [ruleId, rule] of Object.entries(rules)) {
    linter.defineRule(ruleId, rule as any);
  }

  const lintIssues = linter.verify(
    directiveDefinitions + schema,
    {
      parser: '@graphql-eslint/eslint-plugin',
      parserOptions: { schema: directiveDefinitions + schema },
      rules: rulesConfig,
    },
    'schema.graphql',
  );

  const lintWarnings: LintIssueResult[] = [];
  const lintErrors: LintIssueResult[] = [];

  for (const i of lintIssues) {
    if (i.severity === 1) {
      lintWarnings.push({
        ruleId: i.ruleId || undefined,
        severity: LintSeverity.warn,
        message: i.message,
        issueLocation: {
          line: i.line,
          column: i.column,
          endLine: i.endLine,
          endColumn: i.endColumn,
        },
      });
    } else if (i.severity === 2) {
      lintErrors.push({
        ruleId: i.ruleId || undefined,
        severity: LintSeverity.error,
        message: i.message,
        issueLocation: {
          line: i.line,
          column: i.column,
          endLine: i.endLine,
          endColumn: i.endColumn,
        },
      });
    }
  }

  return {
    warnings: lintWarnings,
    errors: lintErrors,
  };
};

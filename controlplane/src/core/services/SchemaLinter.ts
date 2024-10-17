import { parseForESLint, rules } from '@graphql-eslint/eslint-plugin';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Linter } from 'eslint';
import { uid } from 'uid';
import { LintRuleEnum } from '../../db/models.js';
import { LintIssueResult, LintRules, RulesConfig, SchemaLintDTO, SchemaLintIssues } from '../../types/index.js';

export default class SchemaLinter {
  linter: Linter;
  constructor() {
    this.linter = new Linter();
  }

  getRuleModule = (rule: LintRuleEnum) => {
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
        return rules['naming-convention'];
      }
      case 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES': {
        return rules['no-case-insensitive-enum-values-duplicates'];
      }
      case 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS': {
        return rules['no-typename-prefix'];
      }
      case 'ORDER_FIELDS':
      case 'ORDER_ENUM_VALUES':
      case 'ORDER_DEFINITIONS': {
        return rules.alphabetize;
      }
      case 'ALL_TYPES_REQUIRE_DESCRIPTION': {
        return rules['require-description'];
      }
      case 'REQUIRE_DEPRECATION_REASON': {
        return rules['require-deprecation-reason'];
      }
      default: {
        throw new Error(`Rule ${rule} doesnt exist`);
      }
    }
  };

  createRulesConfig = (rules: SchemaLintDTO[]) => {
    const rulesConfig: RulesConfig = {};
    for (const rule of rules) {
      const ruleName = rule.ruleName;
      switch (ruleName) {
        case 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE': {
          rulesConfig[ruleName] = [
            rule.severity,
            { FieldDefinition: { style: 'camelCase' }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE': {
          rulesConfig[ruleName] = [
            rule.severity,
            { ObjectTypeDefinition: { style: 'PascalCase' }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_TYPE_PREFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { ObjectTypeDefinition: { forbiddenPrefixes: ['Type', 'type'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_TYPE_SUFFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { ObjectTypeDefinition: { forbiddenSuffixes: ['Type', 'type'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_INPUT_PREFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { InputObjectTypeDefinition: { forbiddenPrefixes: ['Input', 'input'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_HAVE_INPUT_SUFFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { InputObjectTypeDefinition: { requiredSuffixes: ['Input'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_ENUM_PREFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { EnumTypeDefinition: { forbiddenPrefixes: ['Enum', 'enum', 'ENUM'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_ENUM_SUFFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            { EnumTypeDefinition: { forbiddenSuffixes: ['Enum', 'enum'] }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_INTERFACE_PREFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            {
              InterfaceTypeDefinition: { forbiddenPrefixes: ['Interface', 'interface'] },
              allowLeadingUnderscore: true,
            },
          ];
          break;
        }
        case 'SHOULD_NOT_HAVE_INTERFACE_SUFFIX': {
          rulesConfig[ruleName] = [
            rule.severity,
            {
              InterfaceTypeDefinition: { forbiddenSuffixes: ['Interface', 'interface'] },
              allowLeadingUnderscore: true,
            },
          ];
          break;
        }
        case 'ENUM_VALUES_SHOULD_BE_UPPER_CASE': {
          rulesConfig[ruleName] = [
            rule.severity,
            { EnumValueDefinition: { style: 'UPPER_CASE' }, allowLeadingUnderscore: true },
          ];
          break;
        }
        case 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES': {
          rulesConfig[ruleName] = [rule.severity];
          break;
        }
        case 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS': {
          rulesConfig[ruleName] = [rule.severity];
          break;
        }
        case 'REQUIRE_DEPRECATION_REASON': {
          rulesConfig[ruleName] = [rule.severity];
          break;
        }
        case 'ORDER_FIELDS': {
          rulesConfig[ruleName] = [
            rule.severity,
            { fields: ['ObjectTypeDefinition', 'InterfaceTypeDefinition', 'InputObjectTypeDefinition'] },
          ];
          break;
        }
        case 'ORDER_ENUM_VALUES': {
          rulesConfig[ruleName] = [rule.severity, { values: ['EnumTypeDefinition'] }];
          break;
        }
        case 'ORDER_DEFINITIONS': {
          rulesConfig[ruleName] = [rule.severity, { definitions: true }];
          break;
        }
        case 'ALL_TYPES_REQUIRE_DESCRIPTION': {
          rulesConfig[ruleName] = [rule.severity, { types: true }];
          break;
        }
        default: {
          throw new Error(`Rule ${rule} doesnt exist`);
        }
      }
    }
    return rulesConfig;
  };

  schemaLintCheck = ({ schema, rulesInput }: { schema: string; rulesInput: SchemaLintDTO[] }): SchemaLintIssues => {
    const rulesConfig: RulesConfig = this.createRulesConfig(rulesInput);

    this.linter.defineParser('@graphql-eslint/eslint-plugin', { parseForESLint });

    for (const ruleName of Object.keys(LintRules)) {
      const ruleModule = this.getRuleModule(ruleName as LintRuleEnum);
      if (ruleModule) {
        this.linter.defineRule(ruleName, ruleModule as any);
      }
    }

    const lintIssues = this.linter.verify(
      schema,
      {
        parser: '@graphql-eslint/eslint-plugin',
        // passing the schema through graphQLConfig neglects all the parsing errors
        parserOptions: { graphQLConfig: { schema } },
        rules: rulesConfig,
      },
      `${uid()}.graphql`,
    );

    const lintWarnings: LintIssueResult[] = [];
    const lintErrors: LintIssueResult[] = [];

    for (const i of lintIssues) {
      if (i.severity === 1) {
        lintWarnings.push({
          lintRuleType: (i.ruleId as LintRuleEnum) || undefined,
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
          lintRuleType: (i.ruleId as LintRuleEnum) || undefined,
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
}

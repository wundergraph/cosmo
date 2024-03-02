import { describe, expect, test } from 'vitest';
import { createRulesConfig, schemaLintCheck } from '../src/core/composition/schemaLint.js';
import { LintRuleType, LintSeverityLevel } from '../src/types/index.js';

describe('Linter', (ctx) => {
  test('Should test linting', (testContext) => {
    const schema = `
type Query{
  a: String 
}   

type Mutation {
  addFact(fact: String!): String!
}  
 
enum ProductNamesenum {
  VALUE
  Value
  ENGINE
  FINANCE
  HUMAN_RESOURCES
  MARKETING
  SDK
}

type Employee_A @authenticated {
  id: Int!
}

input InputA{
  a: String
}
`;

    const warningRules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'warn', ruleName: LintRuleType.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'warn', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
    ];

    const errorRules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'error', ruleName: LintRuleType.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'error', ruleName: LintRuleType.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'error', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'error', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
    ];

    const lintWarnings = schemaLintCheck({ schema, rulesInput: warningRules });
    const lintErrors = schemaLintCheck({ schema, rulesInput: errorRules });

    expect(lintWarnings.warnings.length).toBe(4);
    expect(lintWarnings.warnings).toStrictEqual([
      {
        ruleId: 'no-case-insensitive-enum-values-duplicates',
        severity: 0,
        message: 'Unexpected case-insensitive enum values duplicates for enum value "Value" in enum "ProductNamesenum"',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Enumeration value "Value" should be in UPPER_CASE format',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Type "Employee_A" should be in PascalCase format',
        issueLocation: { line: 20, column: 6, endLine: 20, endColumn: 16 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Input type "InputA" should not have "Input" prefix',
        issueLocation: { line: 24, column: 7, endLine: 24, endColumn: 13 },
      },
    ]);
    expect(lintErrors.errors.length).toBe(4);
    expect(lintErrors.errors).toStrictEqual([
      {
        ruleId: 'no-case-insensitive-enum-values-duplicates',
        severity: 1,
        message: 'Unexpected case-insensitive enum values duplicates for enum value "Value" in enum "ProductNamesenum"',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        ruleId: 'naming-convention',
        severity: 1,
        message: 'Enumeration value "Value" should be in UPPER_CASE format',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        ruleId: 'naming-convention',
        severity: 1,
        message: 'Type "Employee_A" should be in PascalCase format',
        issueLocation: { line: 20, column: 6, endLine: 20, endColumn: 16 },
      },
      {
        ruleId: 'naming-convention',
        severity: 1,
        message: 'Input type "InputA" should not have "Input" prefix',
        issueLocation: { line: 24, column: 7, endLine: 24, endColumn: 13 },
      },
    ]);
  });

  test('Should test enum lint rules', (testContext) => {
    const schema = `
enum ProductNamesEnum {
  VALUE
  Value
  ENGINE
  FINANCE
  HUMAN_RESOURCES
  MARKETING
  SDK
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'warn', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_ENUM_SUFFIX },
    ];

    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });

    expect(lintIssues.warnings.length).toBe(3);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Enumerator "ProductNamesEnum" should not have "Enum" suffix',
        issueLocation: { line: 2, column: 6, endLine: 2, endColumn: 22 },
      },
      {
        ruleId: 'no-case-insensitive-enum-values-duplicates',
        severity: 0,
        message: 'Unexpected case-insensitive enum values duplicates for enum value "Value" in enum "ProductNamesEnum"',
        issueLocation: { line: 4, column: 3, endLine: 4, endColumn: 8 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Enumeration value "Value" should be in UPPER_CASE format',
        issueLocation: { line: 4, column: 3, endLine: 4, endColumn: 8 },
      },
    ]);
  });

  test('Should test alphabetical sort lint rules', (testContext) => {
    const schema = `type B{
  b: String
  a: String
}
type A{
  b: String
  a: String
}
enum ProductNamesEnum {
  VALUE
  ENGINE
  FINANCE
  HUMAN_RESOURCES
  MARKETING
  SDK
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.ORDER_DEFINITIONS },
      { severity: 'warn', ruleName: LintRuleType.ORDER_FIELDS },
      { severity: 'warn', ruleName: LintRuleType.ORDER_ENUM_VALUES },
    ];

    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(4);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'alphabetize',
        severity: 0,
        message: 'field "a" should be before field "b"',
        issueLocation: { line: 3, column: 3, endLine: 3, endColumn: 4 },
      },
      {
        ruleId: 'alphabetize',
        severity: 0,
        message: 'type "A" should be before type "B"',
        issueLocation: { line: 5, column: 6, endLine: 5, endColumn: 7 },
      },
      {
        ruleId: 'alphabetize',
        severity: 0,
        message: 'field "a" should be before field "b"',
        issueLocation: { line: 7, column: 3, endLine: 7, endColumn: 4 },
      },
      {
        ruleId: 'alphabetize',
        severity: 0,
        message: 'enum value "ENGINE" should be before enum value "VALUE"',
        issueLocation: { line: 11, column: 3, endLine: 11, endColumn: 9 },
      },
    ]);
  });

  test('Should test deprecated directive lint rules', (testContext) => {
    const schema = `type B{
  b: String @deprecated
  a: String
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.REQUIRE_DEPRECATION_DATE },
      { severity: 'warn', ruleName: LintRuleType.REQUIRE_DEPRECATION_REASON },
    ];
    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(2);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'require-deprecation-date',
        severity: 0,
        message: 'Directive "@deprecated" must have a deletion date for field "b" in type "B"',
        issueLocation: { line: 2, column: 14, endLine: 2, endColumn: 24 },
      },
      {
        ruleId: 'require-deprecation-reason',
        severity: 0,
        message: 'Deprecation reason is required for field "b" in type "B".',
        issueLocation: { line: 2, column: 14, endLine: 2, endColumn: 24 },
      },
    ]);
  });

  test('Should test description lint rules', (testContext) => {
    const schema = `type B{
  b: String
  a: String
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.ALL_TYPES_REQUIRE_DESCRIPTION },
    ];
    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(1);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'require-description',
        severity: 0,
        message: 'Description is required for type "B"',
        issueLocation: { line: 1, column: 6, endLine: 1, endColumn: 7 },
      },
    ]);
  });

  test('Should test field name lint rules', (testContext) => {
    const schema = `type User{
  userId: String
  first_name: String
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.NO_TYPENAME_PREFIX_IN_TYPE_FIELDS },
      { severity: 'warn', ruleName: LintRuleType.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
    ];
    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(2);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'no-typename-prefix',
        severity: 0,
        message: 'Field "userId" starts with the name of the parent type "User"',
        issueLocation: { line: 2, column: 3, endLine: 2, endColumn: 9 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Field "first_name" should be in camelCase format',
        issueLocation: { line: 3, column: 3, endLine: 3, endColumn: 13 },
      },
    ]);
  });

  test('Should test input lint rules', (testContext) => {
    const schema = `input User{
  id: String
  firstName: String
}

input InputUser{
  id: String
  firstName: String
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.SHOULD_HAVE_INPUT_SUFFIX },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
    ];
    const lintIssues = schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(2);
    expect(lintIssues.warnings).toStrictEqual([
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Input type "User" should have one of the following suffixes: Input',
        issueLocation: { line: 1, column: 7, endLine: 1, endColumn: 11 },
      },
      {
        ruleId: 'naming-convention',
        severity: 0,
        message: 'Input type "InputUser" should not have "Input" prefix',
        issueLocation: { line: 6, column: 7, endLine: 6, endColumn: 16 },
      },
    ]);
  });

  test('Should test creating rules config', (testContext) => {
    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'warn', ruleName: LintRuleType.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_TYPE_PREFIX },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'warn', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
    ];

    const rulesConfig = createRulesConfig(rules);

    expect(rulesConfig).toStrictEqual({
      'naming-convention': [
        'warn',
        {
          EnumValueDefinition: { style: 'UPPER_CASE' },
          ObjectTypeDefinition: { style: 'PascalCase', forbiddenPrefixes: ['Type', 'type'] },
          InputObjectTypeDefinition: { forbiddenPrefixes: ['Input', 'input'] },
        },
      ],
      'no-case-insensitive-enum-values-duplicates': ['warn'],
    });
  });
});

import { describe, expect, test } from 'vitest';
import { LintRules, LintSeverityLevel } from '../src/types/index.js';
import { LintRuleEnum } from '../src/db/models.js';
import SchemaLinter from '../src/core/services/SchemaLinter.js';

describe('Linter Tests', (ctx) => {
  test('Should test schema linting', (testContext) => {
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

    const lintRules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'warn', ruleName: LintRules.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
      { severity: 'warn', ruleName: LintRules.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'error', ruleName: LintRules.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
      { severity: 'error', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_PREFIX },
      { severity: 'error', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_SUFFIX },
      { severity: 'error', ruleName: LintRules.SHOULD_HAVE_INPUT_SUFFIX },
    ];

    const schemaLinter = new SchemaLinter();

    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: lintRules });

    expect(lintIssues.warnings.length).toBe(4);
    expect(lintIssues.errors.length).toBe(1);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
        severity: 0,
        message: 'Unexpected case-insensitive enum values duplicates for enum value "Value" in enum "ProductNamesenum"',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        lintRuleType: 'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
        severity: 0,
        message: 'Enumeration value "Value" should be in UPPER_CASE format',
        issueLocation: { line: 12, column: 3, endLine: 12, endColumn: 8 },
      },
      {
        lintRuleType: 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE',
        severity: 0,
        message: 'Type "Employee_A" should be in PascalCase format',
        issueLocation: { line: 20, column: 6, endLine: 20, endColumn: 16 },
      },
      {
        lintRuleType: 'SHOULD_NOT_HAVE_INPUT_PREFIX',
        severity: 0,
        message: 'Input type "InputA" should not have "Input" prefix',
        issueLocation: { line: 24, column: 7, endLine: 24, endColumn: 13 },
      },
    ]);
    expect(lintIssues.errors).toStrictEqual([
      {
        lintRuleType: 'SHOULD_HAVE_INPUT_SUFFIX',
        severity: 1,
        message: 'Input type "InputA" should have one of the following suffixes: Input',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'warn', ruleName: LintRules.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_ENUM_SUFFIX },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });

    expect(lintIssues.warnings.length).toBe(3);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'SHOULD_NOT_HAVE_ENUM_SUFFIX',
        severity: 0,
        message: 'Enumerator "ProductNamesEnum" should not have "Enum" suffix',
        issueLocation: { line: 2, column: 6, endLine: 2, endColumn: 22 },
      },
      {
        lintRuleType: 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
        severity: 0,
        message: 'Unexpected case-insensitive enum values duplicates for enum value "Value" in enum "ProductNamesEnum"',
        issueLocation: { line: 4, column: 3, endLine: 4, endColumn: 8 },
      },
      {
        lintRuleType: 'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.ORDER_DEFINITIONS },
      { severity: 'warn', ruleName: LintRules.ORDER_FIELDS },
      { severity: 'warn', ruleName: LintRules.ORDER_ENUM_VALUES },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(4);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'ORDER_FIELDS',
        severity: 0,
        message: 'field "a" should be before field "b"',
        issueLocation: { line: 3, column: 3, endLine: 3, endColumn: 4 },
      },
      {
        lintRuleType: 'ORDER_DEFINITIONS',
        severity: 0,
        message: 'type "A" should be before type "B"',
        issueLocation: { line: 5, column: 6, endLine: 5, endColumn: 7 },
      },
      {
        lintRuleType: 'ORDER_FIELDS',
        severity: 0,
        message: 'field "a" should be before field "b"',
        issueLocation: { line: 7, column: 3, endLine: 7, endColumn: 4 },
      },
      {
        lintRuleType: 'ORDER_ENUM_VALUES',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.REQUIRE_DEPRECATION_REASON },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(1);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'REQUIRE_DEPRECATION_REASON',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.ALL_TYPES_REQUIRE_DESCRIPTION },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(1);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'ALL_TYPES_REQUIRE_DESCRIPTION',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.NO_TYPENAME_PREFIX_IN_TYPE_FIELDS },
      { severity: 'warn', ruleName: LintRules.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(2);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS',
        severity: 0,
        message: 'Field "userId" starts with the name of the parent type "User"',
        issueLocation: { line: 2, column: 3, endLine: 2, endColumn: 9 },
      },
      {
        lintRuleType: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
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

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.SHOULD_HAVE_INPUT_SUFFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INPUT_PREFIX },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(3);
    expect(lintIssues.warnings).toStrictEqual([
      {
        lintRuleType: 'SHOULD_HAVE_INPUT_SUFFIX',
        severity: 0,
        message: 'Input type "User" should have one of the following suffixes: Input',
        issueLocation: { line: 1, column: 7, endLine: 1, endColumn: 11 },
      },
      {
        lintRuleType: 'SHOULD_HAVE_INPUT_SUFFIX',
        severity: 0,
        message: 'Input type "InputUser" should have one of the following suffixes: Input',
        issueLocation: { line: 6, column: 7, endLine: 6, endColumn: 16 },
      },
      {
        lintRuleType: 'SHOULD_NOT_HAVE_INPUT_PREFIX',
        severity: 0,
        message: 'Input type "InputUser" should not have "Input" prefix',
        issueLocation: { line: 6, column: 7, endLine: 6, endColumn: 16 },
      },
    ]);
  });

  test('Should test type names which start with "_"', (testContext) => {
    const schema = `type _Service{
  sdl: String
}

input UserInput{
  id: String
  firstName: _Service
}

type User{
  service: _Service
}

interface A{
  service: _Service
}
`;

    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
      { severity: 'warn', ruleName: LintRules.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_PREFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_SUFFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_HAVE_INPUT_SUFFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_ENUM_PREFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_ENUM_SUFFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INTERFACE_PREFIX },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INTERFACE_SUFFIX },
      { severity: 'warn', ruleName: LintRules.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
    ];

    const schemaLinter = new SchemaLinter();
    const lintIssues = schemaLinter.schemaLintCheck({ schema, rulesInput: rules });
    expect(lintIssues.warnings.length).toBe(0);
    expect(lintIssues.warnings).toStrictEqual([]);
  });

  test('Should test creating rules config', (testContext) => {
    const rules: { severity: LintSeverityLevel; ruleName: LintRuleEnum }[] = [
      { severity: 'warn', ruleName: LintRules.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRules.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'warn', ruleName: LintRules.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
      { severity: 'warn', ruleName: LintRules.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
      { severity: 'error', ruleName: LintRules.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
      { severity: 'error', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_PREFIX },
      { severity: 'error', ruleName: LintRules.SHOULD_NOT_HAVE_TYPE_SUFFIX },
      { severity: 'error', ruleName: LintRules.SHOULD_HAVE_INPUT_SUFFIX },
    ];

    const schemaLinter = new SchemaLinter();
    const rulesConfig = schemaLinter.createRulesConfig(rules);

    expect(rulesConfig).toStrictEqual({
      TYPE_NAMES_SHOULD_BE_PASCAL_CASE: [
        'warn',
        { ObjectTypeDefinition: { style: 'PascalCase' }, allowLeadingUnderscore: true },
      ],
      SHOULD_NOT_HAVE_INPUT_PREFIX: [
        'warn',
        { InputObjectTypeDefinition: { forbiddenPrefixes: ['Input', 'input'] }, allowLeadingUnderscore: true },
      ],
      DISALLOW_CASE_INSENSITIVE_ENUM_VALUES: ['warn'],
      ENUM_VALUES_SHOULD_BE_UPPER_CASE: [
        'warn',
        { EnumValueDefinition: { style: 'UPPER_CASE' }, allowLeadingUnderscore: true },
      ],
      FIELD_NAMES_SHOULD_BE_CAMEL_CASE: [
        'error',
        { FieldDefinition: { style: 'camelCase' }, allowLeadingUnderscore: true },
      ],
      SHOULD_NOT_HAVE_TYPE_PREFIX: [
        'error',
        { ObjectTypeDefinition: { forbiddenPrefixes: ['Type', 'type'] }, allowLeadingUnderscore: true },
      ],
      SHOULD_NOT_HAVE_TYPE_SUFFIX: [
        'error',
        { ObjectTypeDefinition: { forbiddenSuffixes: ['Type', 'type'] }, allowLeadingUnderscore: true },
      ],
      SHOULD_HAVE_INPUT_SUFFIX: [
        'error',
        { InputObjectTypeDefinition: { requiredSuffixes: ['Input'] }, allowLeadingUnderscore: true },
      ],
    });
  });
});

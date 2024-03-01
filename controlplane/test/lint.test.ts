import { describe, expect, test } from 'vitest';
import { createRulesConfig, schemaLintCheck } from '../src/core/composition/schemaLint.js';
import { LintRuleType, LintSeverityLevel } from '../src/types/index.js';

describe('Linter', (ctx) => {
  test('Should test linting', (testContext) => {
    try {
      const schema = `
type Query{
  a: String 
}   

type Mutation {
  addFact(fact: String!): String!
}  
 
enum ProductNamesenum {
  VALUE
  ENGINE
  FINANCE
  HUMAN_RESOURCES
  MARKETING
  SDK
}

type TypeEmployeeType @authenticated {
  id: Int!
}

input AInput{
  a: String
}
`;

      const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
        { severity: 'warn', ruleName: LintRuleType.ENUM_VALUES_SHOULD_BE_UPPER_CASE },
        // { severity: 'warn', ruleName: LintRuleType.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
        // { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_TYPE_PREFIX },
        // { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
        // { severity: 'error', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
        // { severity: 'error', ruleName: LintRuleType.ROOT_FIELDS_REQUIRE_DESCRIPTION },
      ];

      const issues = schemaLintCheck({ schema, rulesInput: rules });
      console.log(issues.warnings);
      console.log(issues.errors);
      // expect(issues.warnings).toStrictEqual([]);
      // expect(issues.errors).toStrictEqual([]);
    } catch (e) {
      console.log(e);
    }
  });

  test('Should test creating rules config', (testContext) => {
    const rules: { severity: LintSeverityLevel; ruleName: LintRuleType }[] = [
      { severity: 'warn', ruleName: LintRuleType.FIELD_NAMES_SHOULD_BE_CAMEL_CASE },
      { severity: 'warn', ruleName: LintRuleType.TYPE_NAMES_SHOULD_BE_PASCAL_CASE },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_TYPE_PREFIX },
      { severity: 'warn', ruleName: LintRuleType.SHOULD_NOT_HAVE_INPUT_PREFIX },
      { severity: 'error', ruleName: LintRuleType.DISALLOW_CASE_INSENSITIVE_ENUM_VALUES },
    ];

    const a = createRulesConfig(rules);
    console.log(a);

    expect(a).toBe({});
  });
});

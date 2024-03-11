import { countLintConfigsByCategory } from "../lib/utils";
import {
  LintConfig,
  LintSeverity,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { expect, test } from "vitest";

test("return the correct types with deprecated fields or args", async () => {
  const lintIssues = [
    {
      ruleName: "FIELD_NAMES_SHOULD_BE_CAMEL_CASE",
      severityLevel: LintSeverity.error,
    },
    {
      ruleName: "TYPE_NAMES_SHOULD_BE_PASCAL_CASE",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_TYPE_PREFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_TYPE_SUFFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_INPUT_PREFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_HAVE_INPUT_SUFFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_ENUM_PREFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_ENUM_SUFFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_INTERFACE_PREFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "SHOULD_NOT_HAVE_INTERFACE_SUFFIX",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "ENUM_VALUES_SHOULD_BE_UPPER_CASE",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "DISALLOW_CASE_INSENSITIVE_ENUM_VALUES",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "NO_TYPENAME_PREFIX_IN_TYPE_FIELDS",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "REQUIRE_DEPRECATION_REASON",
      severityLevel: LintSeverity.warn,
    },
    {
      ruleName: "REQUIRE_DEPRECATION_DATE",
      severityLevel: LintSeverity.warn,
    },
  ];
  const countByCategory = countLintConfigsByCategory(
    lintIssues as LintConfig[],
  );

  expect(countByCategory).not.toBeNull();
  expect(countByCategory.length).toBe(3);
  expect(countByCategory[0]).toBe(11);
  expect(countByCategory[1]).toBe(0);
  expect(countByCategory[2]).toBe(4);
});

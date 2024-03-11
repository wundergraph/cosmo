export const docsBaseURL = "https://cosmo-docs.wundergraph.com";
export const calURL =
  "https://cal.com/stefan-avram-wundergraph/wundergraph-introduction";
export const lintCategories = [
  {
    title: "Naming Convention",
    description:
      "Configure these rules to enforce naming convention across this namespace's schemas.",
    rules: [
      {
        name: "FIELD_NAMES_SHOULD_BE_CAMEL_CASE",
        description: "Field names should always use camelCase.",
      },
      {
        name: "TYPE_NAMES_SHOULD_BE_PASCAL_CASE",
        description: "Type names should always use PascalCase.",
      },
      {
        name: "SHOULD_NOT_HAVE_TYPE_PREFIX",
        description: "A type's name should never be prefixed with 'Type'.",
      },
      {
        name: "SHOULD_NOT_HAVE_TYPE_SUFFIX",
        description: "A type's name should never be suffixed with 'Type'.",
      },
      {
        name: "SHOULD_NOT_HAVE_INPUT_PREFIX",
        description: "An input's name should never be prefixed with 'Input'.",
      },
      {
        name: "SHOULD_HAVE_INPUT_SUFFIX",
        description: "An input's name should always be suffixed with 'Input'.",
      },
      {
        name: "SHOULD_NOT_HAVE_ENUM_PREFIX",
        description: "An enum's name should never be prefixed with 'Enum'.",
      },
      {
        name: "SHOULD_NOT_HAVE_ENUM_SUFFIX",
        description: "An enum's name should never be suffixed with 'Enum'.",
      },
      {
        name: "SHOULD_NOT_HAVE_INTERFACE_PREFIX",
        description:
          "An interface type's name should never be prefixed with 'Interface'.",
      },
      {
        name: "SHOULD_NOT_HAVE_INTERFACE_SUFFIX",
        description:
          "An interface type's name should never be suffixed with 'Interface'.",
      },
      {
        name: "ENUM_VALUES_SHOULD_BE_UPPER_CASE",
        description: "Enum values should always use UPPER_CASE.",
      },
    ],
  },
  {
    title: "Alphabetical Sort",
    description:
      "Configure these rules to enforce the arrangement of types, fields... in the schema.",
    rules: [
      {
        name: "ORDER_FIELDS",
        description: "Should sort all the fields in alphabetical order.",
      },
      {
        name: "ORDER_ENUM_VALUES",
        description: "Should sort all the enum values in alphabetical order.",
      },
      {
        name: "ORDER_DEFINITIONS",
        description: "Should sort all the definitions in alphabetical order.",
      },
    ],
  },
  {
    title: "Others",
    description:
      "Configure these rules to define conventions throughout our schema.",
    rules: [
      {
        name: "ALL_TYPES_REQUIRE_DESCRIPTION",
        description:
          "Should describe all the type definitions with a description.",
      },
      {
        name: "DISALLOW_CASE_INSENSITIVE_ENUM_VALUES",
        description:
          "Enum values should eliminate duplicates by disallowing case insensitivity.",
      },
      {
        name: "NO_TYPENAME_PREFIX_IN_TYPE_FIELDS",
        description: "Field names should not be prefixed with its type's name.",
      },
      {
        name: "REQUIRE_DEPRECATION_REASON",
        description: "Should provide the reason on @deprecated directive.",
      },
      {
        name: "REQUIRE_DEPRECATION_DATE",
        description:
          "Should provide the deletion date on @deprecated directive.",
      },
    ],
  },
];

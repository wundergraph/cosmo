export const docsBaseURL = "https://cosmo-docs.wundergraph.com";
export const scimBaseURL = "https://cosmo-cp.wundergraph.com/scim/v2";
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
    ],
  },
];

export const graphPruningRules = [
  {
    name: "UNUSED_FIELDS",
    description: "Returns all the unused fields in the schema.",
  },
  {
    name: "DEPRECATED_FIELDS",
    description:
      "Returns all the deprecated fields that need to be removed from the schema.",
  },
  {
    name: "REQUIRE_DEPRECATION_BEFORE_DELETION",
    description: "Returns all the deleted fields which were not deprecated.",
  },
];

export const OPTION_TYPES = {
  OPERATION: 'operation',
  VARIABLES: 'variables',
  HEADERS: 'headers',
  PRE_FLIGHT: 'preFlight',
  PRE_OPERATION: 'preOperation',
  POST_OPERATION: 'postOperation',
} as const;

export const hideScriptsSharing = true;

export const SHARE_OPTIONS = [
  // operation is always checked and disabled
  { 
    id: OPTION_TYPES.OPERATION,
    label: "Operation",
    description: "The GraphQL operation (query, mutation, or subscription) to be shared",
    isChecked: true,
    isDisabled: true
  },
  { 
    id: OPTION_TYPES.VARIABLES,
    label: "Variables",
    description: "The variables used in the GraphQL operation",
    isChecked: false,
    isDisabled: false
  },
  { 
    id: OPTION_TYPES.HEADERS,
    label: "Headers",
    description: "The HTTP headers to include in the shared request",
    isChecked: false,
    isDisabled: false
  },
  // [ENG-7093] hiding scripts sharing for now
  ...!hideScriptsSharing ? [{ 
    id: OPTION_TYPES.PRE_FLIGHT,
    label: "Pre-Flight Script",
    description: "A script that runs before the GraphQL operation is executed",
    isChecked: false,
    isDisabled: false
  },
  { 
    id: OPTION_TYPES.PRE_OPERATION,
    label: "Pre-Operation Script",
    description: "A script that runs before sending the GraphQL request",
    isChecked: false,
    isDisabled: false
  },
  { 
    id: OPTION_TYPES.POST_OPERATION,
    label: "Post-Operation Script",
    description: "A script that runs after the GraphQL request is completed",
    isChecked: false,
    isDisabled: false
  }] : [],
] as const;

export const PLAYGROUND_STATE_QUERY_PARAM = 'playgroundUrlState';

export const PLAYGROUND_DEFAULT_QUERY_TEMPLATE = `# Welcome to WunderGraph Studio
#
#
# Type queries into this side of the screen, and you will see intelligent
# typeaheads aware of the current GraphQL type schema and live syntax and
# validation errors highlighted within the text.
#
# GraphQL queries typically start with a "{" character. Lines that start
# with a # are ignored.
#
# An example GraphQL query might look like:
#
#     {
#       field(arg: "value") {
#         subField
#       }
#     }
#
# Keyboard shortcuts:
#
#   Prettify query:  Shift-Ctrl-P (or press the prettify button)
#
#  Merge fragments:  Shift-Ctrl-M (or press the merge button)
#
#        Run Query:  Ctrl-Enter (or press the play button)
#
#    Auto Complete:  Ctrl-Space (or just start typing)
#
`;

export const PLAYGROUND_DEFAULT_HEADERS_TEMPLATE = `{
  "X-WG-TRACE" : "true"
}`;

export const roles = [
  {
    key: "organization-admin",
    category: "organization",
    displayName: "Admin",
    description: "Grants full access to the organization and all its resources.",
  },
  {
    key: "organization-developer",
    category: "organization",
    displayName: "Developer",
    description: "Grants write access to all the organization resources.",
  },
  {
    key: "organization-apikey-manager",
    category: "organization",
    displayName: "API Key Manager",
    description: "Grants access to creating, updating and deleting API keys in the organization.",
  },
  {
    key: "organization-viewer",
    category: "organization",
    displayName: "Viewer",
    description: "Grants readonly access to all the organization resources.",
  },
  {
    key: "namespace-admin",
    category: "namespace",
    displayName: "Admin",
    description: "Grants write access to the selected namespaces.",
  },
  {
    key: "namespace-viewer",
    category: "namespace",
    displayName: "Viewer",
    description: "Grants readonly access to the selected namespaces.",
  },
  {
    key: "graph-admin",
    category: "graph",
    displayName: "Admin",
    description: "Grants write access to the selected federated graphs.",
  },
  {
    key: "graph-viewer",
    category: "graph",
    displayName: "Viewer",
    description: "Grants readonly access to the selected federated graphs.",
  },
  {
    key: "subgraph-admin",
    category: "subgraph",
    displayName: "Admin",
    description: "Grants write access to the selected subgraphs.",
  },
  {
    key: "subgraph-publisher",
    category: "subgraph",
    displayName: "Publisher",
    description: "Grants publish access to the selected subgraphs.",
  },
  {
    key: "subgraph-checker",
    category: "subgraph",
    displayName: "Checker",
    description: "Grants access to creating checks for the selected subgraphs.",
  },
  {
    key: "subgraph-viewer",
    category: "subgraph",
    displayName: "Viewer",
    description: "Grants readonly access to the selected subgraphs.",
  },
];

export type OrganizationRole = typeof roles[number]["key"];
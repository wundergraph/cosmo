# Subgraph Errors Extension Specification

## Problem

For security reasons, we're currently not exposing Subgraph Errors to the client.
Subgraphs might leak sensitive information in the error object, e.g. through the `extensions` field.

What we've learned from our users is that they would like to leverage the `extensions` field to provide more context to the client,
e.g. by adding a `code` field to the error object.

A response object might look like this:

```json
{
  "errors": [
    {
      "message": "Cannot query field 'foo' on type 'Bar'",
      "path": [
        "foo"
      ],
      "extensions": {
        "code": "GRAPHQL_VALIDATION_FAILED"
      }
    }
  ]
}
```

With this information, the client can now handle the error more gracefully.

However, this leads to the problem that Subgraph owners might send "anything" in the `extensions` field,
which might leak sensitive information.

Another problem is that users would like to standardize the error codes across different Subgraphs,
e.g. `GRAPHQL_VALIDATION_FAILED` should always mean the same thing,
and there should be agreement across all Subgraph owners on what codes to use.

Additional fields in the `extensions` object could also be allowed, e.g. `message` or `severity`,
but it's important that all Supergraph contributors agree on what fields and values are allowed.

## Solution

We propose to introduce the ability to define a schema for the `extensions` field in the Supergraph.
As the response encoding is JSON, we can leverage JSON Schema to define the schema for the error object.

The schema can be attached at the Supergraph level using the `wgc` cli tool using the following command:

```bash
npx wgc federated-graph create production -r http://router.example.com/graphql --label-matcher team=A department=backend --errors-extensions-schema ./errors-extensions-schema.json
```

Example of updating the schema for an existing Supergraph:

```bash
npx wgc federated-graph update production --errors-extensions-schema ./errors-extensions-schema.json
```

The schema file should look like this:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "enum": [
        "GRAPHQL_VALIDATION_FAILED",
        "GRAPHQL_EXECUTION_FAILED"
      ]
    }
  },
  "required": [
    "code"
  ],
  "additionalItems": false
}
```

The `additionalItems` field is set to `false` to ensure that only the fields defined in the schema are allowed.

In addition to just defining the schema,
we also propose to add an additional option to define the behavior when the schema validation fails.

When the JSON Schema validation fails for an `extensions` field,
the Engine can either "skip" this field in the response object or "fail" the error rendering process and return a generic error message to the client.
In addition, the Engine can log the error to the logs for debugging purposes and notify the Subgraph owner that their Subgraph is not returning errors in the correct format.

The behavior can be defined in the Supergraph using the following command:

```bash
npx wgc federated-graph create production -r http://router.example.com/graphql --label-matcher team=A department=backend --errors-extensions-schema ./errors-extensions-schema.json --errors-extensions-validation-behavior skip
```

Example of updating the behavior for an existing Supergraph:

```bash
npx wgc federated-graph update production --errors-extensions-validation-behavior skip
```

The default behavior is to "skip" the field and log a warning to the logs.

In addition to the above,
we also propose to make the extensions Schema visible in Studio so that Subgraph owners can see what fields are allowed in the `extensions` object.

To integrate this solution into the overall architecture and workflow,
we propose that the Supergraph owner(s) setup a CI/CD pipeline that publishes the Errors Extension Schema from a git repository to the Supergraph.
This way, the source of truth for the schema is in the git repository,
and the Subgraph owners can make pull requests to update the schema,
e.g. to add new error codes or fields to the `extensions` object.

## Explanation of the Solution

We thought about allowing Subgraph owners to define the schema for the `extensions` field in the Subgraph itself,
which would give them more flexibility and autonomy.
However, this would lead to a more fragmented ecosystem of error codes and allowed fields in the `extensions` object,
so that codes are not standardized across different Subgraphs and therefore less useful for the client.

We also believe that it helps organizations to have a centralized place to define the schema for the `extensions` field,
encouraging collaboration and standardization across different teams and Subgraphs.

Another benefit of this solution is that clients can use the JSON Schema to generate client-side code to handle the errors more gracefully,
e.g. by generating TypeScript types for the error object.
---
title: "Graph Pruning / Garbage Collection of unused fields"
author: Jens Neuse
---

This RFC describes a new workflow to continuously clean up the GraphQL Schema.
The goal is to remove unused fields from the schema to keep it clean and more maintainable.

## Problem

The GraphQL Schema is a living document that evolves over time.
Fields are added, modified, and removed.
Over time, fields that are no longer used are not removed from the schema.
This leads to a bloated schema that is hard to understand and maintain.

Cosmo already has metrics that show which fields are used or not,
but there is no automated way or workflow to remove unused fields from the schema.

Removing unused fields through an automated process has the following benefits:
1. The schema is easier to read understand
2. The schema is easier to maintain
3. Unused Code in resolvers can be removed, reducing complexity and technical debt
4. The schema is smaller, which can lead to better performance

## Solution

The simplest possible solution is to re-use the existing workflow for schema composition checks to also check for unused fields.
Schema composition checks are already part of the CI/CD pipeline and are executed whenever a new version of a subgraph is published.
We can extend this workflow to also check for unused fields.

We have several tools to facilitate this.
We can have strict rules (fail CI) for unused fields, or we can have warnings.
Depending on how strict the organization wants to operate,
they can choose the appropriate level of strictness.

In addition, you should be able to immediately remove unused fields or deprecate them first.

## Implementation

First, we need to define the rules for unused fields.
We might want to have different rules for different environments,
so it would make sense to define these rules on the namespace level.

Let's create a new namespace:

```shell
npx wgc namespace create production --unused-fields-warn=30 --unused-fields-fail=60
```

This command creates a new namespace called `production` with the following rules:
- If a field is unused for more than 30 days, a warning is shown in the CI/CD pipeline
- If a field is unused for more than 60 days, the CI/CD pipeline fails

The rules can be adjusted at any time:

```shell
npx wgc namespace update production --unused-fields-warn=60 --unused-fields-fail=90
```

This command updates the rules for the `production` namespace:
- If a field is unused for more than 60 days, a warning is shown in the CI/CD pipeline
- If a field is unused for more than 90 days, the CI/CD pipeline fails

It's also possible to disable the rules:

```shell
npx wgc namespace update production --unused-fields-warn=0 --unused-fields-fail=0
```

Maybe you'd only like to have warnings:

```shell
npx wgc namespace update production --unused-fields-warn=30 --unused-fields-fail=0
```

### The @deprecated directive resets the counter

If an unused field causes a warning or a failure in the CI/CD pipeline,
you can deprecate the field to reset the counter:

```graphql
type Query {
  oldField: String @deprecated(reason: "This field is deprecated")
}
```

Let's say that the `oldField` is unused for 30 days.
The CI/CD pipeline will show a warning.
We deprecate the field, and the counter is reset.
If the deprecated field is unused for another 30 days,
the CI/CD pipeline will show a warning again.

The field now was unused for 60 days,
which should be enough time to be sure that the field is not used anymore.

### Analytics must exist for more than the threshold period

To avoid false positives, we should only consider fields that have been unused for more than the threshold period.
This means that we need to keep track of the last time a field was changed.
When a field is added or modified, we keep track of the timestamp.
Fields that have been added or modified within the threshold period are not considered for pruning.

Let's say that the threshold period is 30 days.
If a field was added 20 days ago and is not used,
it should not be considered for pruning.
A field must exist for more than 30 days in the Schema Registry to be considered for pruning.

### Notifications

Internally, Cosmo can run a daily job to check for unused fields.
If a warning or failure is detected,
a notification can be sent to the Slack channel or via Webhook.

You can configure the notification settings at the organization level.

### Defaults

All existing namespaces and newly created namespaces will have the following default pruning rules:

1. Warn after 15 days
2. Fail after 30 days

These should be good defaults for most organizations to keep the schema clean.

## Why structuring the workflow like this?

By using the existing CI/CD pipeline, we're giving the Subgraph owners direct feedback on the quality of their schema.
Instead of having a separate tool or process to clean up the schema,
we're integrating this into the existing workflow.

We've also considered of suggesting Pull Requests to remove unused fields automatically,
but we think that we'd like to give the Subgraph owners the control over their schema.
We also don't want to introduce additional workflows that might be too intrusive.

## Escape Hatch

It's possible that some fields are not used in the Schema but there are other reasons to keep them,
e.g. for business reasons or because there are plans to use them in the future.

In this case, you can add a special comment to the field:

```graphql
type Query {
  # wgc-check:ignore-unused
  oldField: String
}
```

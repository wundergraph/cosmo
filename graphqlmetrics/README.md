# GraphQLMetrics

GraphQLMetrics is a service that collects, process and exports operation schema metrics for GraphQL APIs.
It allows to efficiently track and store metrics to ClickHouse database.

## Migrations

Migration are run automatically on application start. We use [dbmate](https://github.com/amacneil/dbmate) to manage migrations in code.
Please ensure that only run instance is running migrations at the same time. In Kubernetes, you can configure this by setting `maxSurge` to 1 and `maxUnvailable` to 0.

### Creating new migration

To create new migration run:

```bash
make new-migration <migration_name>
```
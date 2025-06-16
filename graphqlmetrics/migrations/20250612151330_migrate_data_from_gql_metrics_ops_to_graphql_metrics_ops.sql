-- migrate:up

INSERT INTO graphql_metrics_operations (
    Timestamp,
    OperationName,
    OperationHash,
    OperationType,
    OperationContent,
)
SELECT 
    Timestamp,
    OperationName,
    OperationHash,
    OperationType,
    OperationContent,
FROM gql_metrics_operations;

-- migrate:down

DELETE FROM graphql_metrics_operations;


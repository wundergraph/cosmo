# Persisted Operations

Persisted operations are stored queries, which can be executed just by providing the sha256hash of the operation to the router. This is useful for multiple purposes, including: 
* large/frequently requested queries, which can be stored to avoid sending them over the network multiple times
* for security purposes, where a consumer can specify the specific operations which can be run, and the router can verify that the operation is one of the allowed ones

Specifically for those two purposes, we enable two different methods of storing persisted operations:
1. **Persisted Operation Files** - This operation, documented [here](https://cosmo-docs.wundergraph.com/router/persisted-operations), allows users to store persisted operations in files in a CDN/S3 bucket, which are then loaded by the router. This is both useful for storing large queries, as well as by reducing the router's attack surface by only allowing registered operations
2. **Automatic Persisted Queries** - This setting allows users to automatically cache queries that are sent, as long as they are sent together with their sha256hash. This is a useful performance optimizer, as it allows the router to cache queries that are frequently requested, without the need to manually store them in a file.

These two uses can exist in concert - users can save a number of particular operations in persisted operation files, and then use automatic persisted queries to cache the rest of the queries that are sent to the router.

## Flows
1. **Persisted Operations, no APQ** &rarr; In this scenario, the router will only execute queries that are stored in persisted operation files. If a query is not found in the persisted operation files, the router will return an error if a user tries calling a `persisted operation` with an unknown sha. After the query is planned, the router will cache the normalized query in the local persisted operation cache.
1. **APQ, No Persisted Operations** &rarr; In this scenario, if a `persisted_operation` request is sent, the router will first check if there is an APQ cached that matches. If a query is found, the router will execute the query. If a query is not found, the router will look if a query was submitted together with the persisted operation hash. If so, it will execute that query and save it in the cache for the future, and if not, the router will return an error.
1. **No APQ, No Persisted Operations** &rarr; If a persisted operation is sent, the router will return an error, as there are no persisted operations stored. Even if a query is sent, the router will still error because APQ isn't enabled.
1. **APQ and Persisted Operations** &rarr; In this scenario, the router will first check if the query was stored as an APQ. If it is, the router will execute the query. If it is not, the router will check the persistent query files. If the query is found, the router will execute the query. If the query is not found, the router will check if the query was sent together with the persisted operation hash. If it was, the router will execute the query and save it in the APQ cache for the future. If it was not, the router will return an error.

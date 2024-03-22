# WunderGraph Cosmo Router

The router is the component that understands the GraphQL Federation protocol. It is responsible for routing requests to the correct service and for aggregating the responses. While it maintains a connection with the Control Plane, its operation is independent and does not hinge on the Control Plane's functionality.

Technically, it fetches the latest valid router configuration from the CDN and creates a highly-optimized query planner. This query planner is cached across requests. In certain intervals, it checks the CDN for new updates and reconfigures its engine on the fly.

It uses the control plane API to register itself, which enables reporting on the status and health of the router fleet.

## Documentation 

Extensive documentation for the router can be found [here](https://cosmo-docs.wundergraph.com/router/intro).
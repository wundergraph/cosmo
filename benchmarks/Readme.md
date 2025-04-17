# Cosmo Router Benchmarking Test Suite

The purpose of this subfolder is to create a benchmarking framework that we can use to ensure that the performance of the router is maintained.


## How to Run Locally

1. Ensure that you are in the `/benchmarks` folder
2. Run `make setup` which will:
  - Setup the docker services that are meant for the tests
  - Compose the router configuration

3. Run `make run-scenarios` and you will see all of the scenarios play out


## Scenarios

Each scenario lives inside of a file inside of `benchmark-scenarios/src`, and is run with [k6](https://k6.io/)

### Current Scenarios

- `errors` - Used to ensure that the router is performant when there are errors present in a call
- `mutations` - This is used to verify that mutations work, and to see the performance during a mutation call
- `queries` - This is used to verify that queries work, and to see the performance during a query
- `random` - This uses random queries from a list to measure performance during more normal operations
- `subscriptions` - This uses websockets to ensure performance of the subscription types


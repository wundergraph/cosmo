import http from 'k6/http';
import { sleep, check } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

export default function () {
  let headers = {
    'Content-Type': 'application/json',
    // Graph API token
    Authorization:
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJmZWRlcmF0ZWRfZ3JhcGhfaWQiOiI3N2U0MDBjYy01NmQ2LTQ5ZTctODc4My0zMzExY2U1MzU5YzIiLCJvcmdhbml6YXRpb25faWQiOiJhNzdkNzRkZC05YTE1LTQxZDItOGU0My01NjBhYzMxNTA5NDAiLCJpYXQiOjE2OTcxMTEzNjF9.8E4UO_tDFM-VYNeAAGIotHHu0TjNoxB3bX12sHUz-ns',
  };

  const randomHash = randomString(32);

  let res = http.post(
    'http://localhost:4005/wg.cosmo.graphqlmetrics.v1.GraphQLMetricsService/PublishGraphQLMetrics',
    `{"SchemaUsage":[{"OperationDocument":"query GetProducts($category: String) { products(category: $category) { id, name, price } }","TypeFieldMetrics":[{"OperationType":"query","Path":["products"],"TypeNames":["Product"],"Count":1,"Source":{"SubgraphID":"Product"}},{"OperationType":"query","Path":["products","name"],"TypeNames":["String"],"Count":1,"Source":{"SubgraphID":"Product"}},{"OperationType":"query","Path":["reviews"],"TypeNames":["Review"],"Count":1,"Source":{"SubgraphID":"Reviews"}},{"OperationType":"query","Path":["reviews","author"],"TypeNames":["Author"],"Count":1,"Source":{"SubgraphID":"Reviews"}},{"OperationType":"query","Path":["reviews","author","name"],"TypeNames":["String"],"Count":1,"Source":{"SubgraphID":"Reviews"}}],"OperationInfo":{"OperationHash":"${randomHash}","OperationName":"GetProducts","OperationType":"query"},"RequestInfo":{"FederatedGraphID":"graph123","OrganizationID":"org456","RouterConfigVersion":"v2"},"Attributes":{"customAttribute1":"value1","customAttribute2":"value2"}}]}`,
    { headers: headers },
  );
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
}

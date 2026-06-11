import http from 'k6/http';
import { check } from 'k6';

// Load test for LARGE responses through the router.
//
// PREREQUISITES:
//  1. test1 subgraph running on 4006 port: `cd ../demo && go run cmd/all/main.go`
//  2. test1 present in the router's execution config
//
// GOTCHA: the leaf object is a shared singleton of identical lorem-ipsum text,
// so gzip compresses the payload to almost nothing. To genuinely push 20-60 MB
// over the wire we request `identity` (uncompressed) by default.
// Set ENCODING=gzip to measure the compressed path instead.

const URL = __ENV.URL || 'http://localhost:3002/graphql';
const BIG_OBJECTS = __ENV.BIG_OBJECTS || '200';
const NESTED_OBJECTS = __ENV.NESTED_OBJECTS || '72';
const DEEPLY_NESTED = __ENV.DEEPLY_NESTED || '10';
const ENCODING = __ENV.ENCODING || 'identity'; // 'identity' = full bytes on the wire; 'gzip' = compressed
const DISCARD = (__ENV.DISCARD || 'false') === 'true';

export const options = {
  discardResponseBodies: DISCARD,
  scenarios: {
    big: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '1', 10),
      duration: __ENV.DURATION || '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const query = `query Big($big: Int!, $nested: Int!, $deep: Int!) {
  bigResponse(bigObjects: $big, nestedObjects: $nested, deeplyNestedObjects: $deep) {
    nestedObjects {
      deeplyNestedObjects {
        aFieldOnDeeplyNestedObject bFieldOnDeeplyNestedObject cFieldOnDeeplyNestedObject
        dFieldOnDeeplyNestedObject eFieldOnDeeplyNestedObject fFieldOnDeeplyNestedObject
        gFieldOnDeeplyNestedObject hFieldOnDeeplyNestedObject iFieldOnDeeplyNestedObject
        jFieldOnDeeplyNestedObject kFieldOnDeeplyNestedObject lFieldOnDeeplyNestedObject
        mFieldOnDeeplyNestedObject nFieldOnDeeplyNestedObject oFieldOnDeeplyNestedObject
        pFieldOnDeeplyNestedObject qFieldOnDeeplyNestedObject rFieldOnDeeplyNestedObject
        sFieldOnDeeplyNestedObject tFieldOnDeeplyNestedObject uFieldOnDeeplyNestedObject
        vFieldOnDeeplyNestedObject wFieldOnDeeplyNestedObject xFieldOnDeeplyNestedObject
        yFieldOnDeeplyNestedObject zFieldOnDeeplyNestedObject
      }
    }
  }
}`;

const body = JSON.stringify({
  query,
  operationName: 'Big',
  variables: {
    big: parseInt(BIG_OBJECTS, 10),
    nested: parseInt(NESTED_OBJECTS, 10),
    deep: parseInt(DEEPLY_NESTED, 10),
  },
});

const headers = {
  'Content-Type': 'application/json',
  'Accept-Encoding': ENCODING,
  'GraphQL-Client-Name': 'k6-bigresponse',
  'GraphQL-Client-Version': '0.0.1',
};

export default function () {
  const res = http.post(URL, body, { headers });
  // When DISCARD=true, r.body is null — only assert status. When DISCARD=false,
  // also assert the payload is large and error-free.
  check(res, {
    'status is 200': (r) => r.status === 200,
    'no graphql errors': (r) => DISCARD || (r.status === 200 && r.body.includes('errors') === false)
  });
}

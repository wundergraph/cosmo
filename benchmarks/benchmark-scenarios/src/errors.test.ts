import http from 'k6/http';
import { Options } from 'k6/options';
import { check } from 'k6';
export const options: Options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '20s', target: 100 },
  ],
};

const query = `
query benchQuery {
  products {
    id
    name
    sku
    price
    images
  }
}
`;

export default function () {
  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };
  
  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: query, operationName: 'benchQuery' }), {
    headers: headers,
  });

  check(res, {
    'status code MUST be 200': (r) => r.status == 200,
    'must have errors': (r) => r.json('errors') !== null,
  })
}


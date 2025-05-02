import { Options } from 'k6/options';
import http from 'k6/http';
import { check, fail } from 'k6';

export const options: Options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '20s', target: 100 },
  ],
};

export default function () {
  let query = `
  query benchQuery {
  chatRooms {
    id
    name
    product {
      ...ProductDetails
    }
  }
}

fragment ProductDetails on Product {
  id
  name
  price
}`;

  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };

  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: query, operationName: 'benchQuery' }), {
    headers: headers,
  });

  if (
    !check(res, {
      'status code MUST be 200': (r) => r.status == 200,
    })
  ) {
    fail('status code was *not* 200');
  }

  check(res, {
    'is status 200': (r) => r.status === 200 && r.json('errors') === false,
  });
}
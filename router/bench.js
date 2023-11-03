import http from 'k6/http';
import { sleep, check } from 'k6';

export default function () {
  let query = `
  query Bench {
    employees {
      # resolved through employees subgraph
      id
    }
  }`;

  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };

  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: query, operationName: 'Bench' }), {
    headers: headers,
  });
  check(res, {
    'is status 200': (r) => r.status === 200 && r.body.includes('errors') === false,
  });

  sleep(0.3);
}

import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    //{ duration: '1m30s', target: 100 },
    //{ duration: '20s', target: 0 },
  ],
};

export default function () {
  let query = `
  query Bench {
    employees {
      details {
        forename
      }
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
}

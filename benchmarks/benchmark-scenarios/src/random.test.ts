import { check, fail } from 'k6';
import http from 'k6/http';
import { Options } from 'k6/options';

export const options: Options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '20s', target: 100 },
  ],
};


let randomQueries: string[] = [
  `
  query benchQuery {
    products {
      id
    }
  }
  `,
  `
  query benchQuery {
  chatRooms {
    id
    name
    users {
      id
      email
      name
    }
    messages {
      id
      message
    }
  }
}
  `,
  `query benchQuery {
  chatMessages(roomId: "1") {
    id
    message
    sender {
      id
      name
      email
    }
  }
}`,
`
mutation benchQuery {
  createProduct(name: "1", price: 1.5, sku: "qsd") {
    description
    id
  }
}`,
`mutation benchQuery {

  createUser(email: "demo@example.com", name: "DemoUser", password: "abcderfs") {
    createdAt
    email
    id
  }
}`
];


export default function () {
  const randomIndex = Math.floor(Math.random()*randomQueries.length)
  const randomQuery = randomQueries[randomIndex];

  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };


  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: randomQuery, operationName: 'benchQuery' }), {
    headers: headers,
  });

  if (!check(res, {
    'is status 200': (r) => r.status === 200 && !r.json('errors'),
  })) {
    fail('status code was *not* 200');
  }
}

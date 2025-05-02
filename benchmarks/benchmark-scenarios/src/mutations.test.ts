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



const mutationQuery = (sku: string) => `
mutation MutationQuery {
  sendMessage(message: "adfads", roomID: "1", senderId: "1") {
    id
  }
  createProduct(
    name: "Hello Products"
    price: 1.5
    sku: "${sku}"
    description: "Demo Product"
    imageUrl: ""
  ) {
    id
  }
}`;

export default function () {
  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };

  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: mutationQuery(`demo-${__VU}`), operationName: 'MutationQuery' }), {
    headers: headers,
  });

  if (res.json('errors')) {
    console.log(res.json('errors'));
  }

  check(res, {
    'status code MUST be 200': (r) => r.status == 200,
    'is status 200': (r) => r.status === 200 && !r.json('errors'),
    'is product created': (r) => r.json('data.createProduct.id') !== null,
    'is message sent': (r) => r.json('data.sendMessage.id') !== null,
  })
}


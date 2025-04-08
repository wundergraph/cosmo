import { Options } from 'k6/options';
import * as ws from 'k6/ws';
import { check } from 'k6';
// @ts-ignore import from k6-utils
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options: Options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '20s', target: 100 },
  ],
};

const subscriptionQuery = `
subscription SubscriptionQuery {
  chatMessages(roomId: "1") {
    createdAt
    id
  }
}`;

export default function () {
  const headers = {
    'Sec-WebSocket-Protocol': 'graphql-ws',
  };

  const res = ws.connect(
    "ws://localhost:3002/graphql",
    {
      headers,
    },
    (socket) => {
      socket.on('message', (msg) => {
        const message = JSON.parse(msg);
        if (message.type == 'connection_ack') console.log('Connection Established with WebSocket');
        if (message.type == 'data') console.log(`Message Received: ${message}`);
      });
      socket.on('open', () => {
        const id = uuidv4();
        socket.send(
          JSON.stringify({
            type: 'connection_init',
            payload: headers,
          }),
        );
        socket.send(
          JSON.stringify({
            id: id,
            type: 'subscribe',
            payload: {
              query: subscriptionQuery,
              operationName: 'SubscriptionQuery',
            },
          }),
        );

        setTimeout(() => {
          socket.send(
            JSON.stringify({
              id: id,
              type: 'complete',
            }),
          );
        }, 1000);
      });
    },
  );

  check(res, {
    'status code MUST be 101': (r) => r.status == 101,
  })
};

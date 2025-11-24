import ws from 'k6/ws';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/*
  This script was originally intended to simulate an extremely high load on websocket connections. It may also be useful as a base for new websocket scenarios.
*/

export const options = {
  stages: [
    { duration: '0s', target: 10000 }, // Start immediately at 500 VUs
    { duration: '5m', target: 10000 }, // Ramp up to 1000 over 5 minutes
  ],
};

export default function () {
  const id = uuidv4();

  const max = 120;
  const intervalMilliseconds = 500;

  const url = 'ws://localhost:3002/graphql';
  const params = {
    headers: {
      'Sec-WebSocket-Protocol': 'graphql-transport-ws',
      'X-User-Id': id,
    },
  };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      // Send connection_init message
      console.log(`${id}: Connection initialized`);
      socket.send(
        JSON.stringify({
          type: 'connection_init',
        }),
      );
    });

    socket.on('message', function (message) {
      const data = JSON.parse(message);

      let recieved = 0;

      switch (data.type) {
        case 'connection_ack':
          // Connection acknowledged, start subscription
          socket.send(
            JSON.stringify({
              id: id,
              type: 'subscribe',
              payload: {
                query: `subscription { countHob(max: ${max}, intervalMilliseconds: ${intervalMilliseconds}) }`,
              },
            }),
          );
          console.log(`${id}: Subscription started`);
          break;
        case 'next':
          recieved++;

          if (recieved >= 5) {
            socket.send(
              JSON.stringify({
                id: id,
                type: 'complete',
              }),
            );
          }
          break;
        case 'complete':
          console.log(`${id}: Subscription completed`);
          break;
      }
    });

    socket.on('close', function () {
      console.log('WebSocket connection closed');
    });

    socket.on('error', function (e) {
      if (e.error() != 'websocket: close sent') {
        console.log('WebSocket error:', e.error());
      }
    });
  });

  check(res, {
    'WebSocket connection established': (r) => r && r.status === 101,
  });
}

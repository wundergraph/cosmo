import ws from 'k6/ws';
import { check } from 'k6';

/*
  This script was originally intended to simulate an extremely high load on websocket connections. It may also be useful as a base for new websocket scenarios.
*/

export const options = {
  stages: [
    { duration: '0s', target: 10000 },
    { duration: '5m', target: 10000 },
  ],
};

export default function () {
  const url = 'ws://localhost:3002/graphql';
  const params = {
    headers: {
      'Sec-WebSocket-Protocol': 'graphql-transport-ws',
    },
  };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      // Send connection_init message
      socket.send(
        JSON.stringify({
          type: 'connection_init',
        }),
      );
    });

    socket.on('message', function (message) {
      const data = JSON.parse(message);

      console.log(message);

      switch (data.type) {
        case 'connection_ack':
          // Connection acknowledged, start subscription
          socket.send(
            JSON.stringify({
              id: '1',
              type: 'subscribe',
              payload: {
                query: 'subscription { countHob(max: 50000, intervalMilliseconds: 1) }',
              },
            }),
          );
          console.log('Subscription started');
          break;
        case 'next':
          console.log('Subscription next:', data.payload);
          break;
        case 'complete':
          console.log('Subscription completed');
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

  // Cancel subscription after 20 seconds
  setTimeout(() => {
    socket.send(
      JSON.stringify({
        id: '1',
        type: 'complete',
      }),
    );
    socket.close();
  }, 20000);

  check(res, {
    'WebSocket connection established': (r) => r && r.status === 101,
  });
}

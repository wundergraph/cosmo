This directory contains a custom built version of graphiql that is used in the studio.

To work with go embed the following setup is used for graphiql.
```js
const url = '{{graphqlURL}}';
const subscriptionUrl = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + url;
```
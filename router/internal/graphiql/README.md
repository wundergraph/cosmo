This directory contains a copy of the graphiql-cdn example found at
https://github.com/graphql/graphiql/tree/main/examples/graphiql-cdn
with a small modifications to set up the URL and subscription URL
from a relative URL, namely the following two lines:

```js
const url = '{{graphqlURL}}';
const subscriptionUrl = window.location.protocol.replace('http', 'ws') + '//' + window.location.host + url;
```

Git ref at last update: 85edb9e

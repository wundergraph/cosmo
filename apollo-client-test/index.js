import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client/core/index.js';
import fetch from 'cross-fetch';
import { loadErrorMessages, loadDevMessages } from '@apollo/client/dev/index.js';

// if (__DEV__) {
//   // Adds messages only in a dev environment
loadDevMessages();
loadErrorMessages();
// }

// Make sure your router is running on this URL
// cosmo router
const ROUTER_URL = 'http://localhost:3026/graphql';
// yoga
// const ROUTER_URL = 'http://localhost:4000/graphql';

const client = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({
    uri: ROUTER_URL,
    fetch,
    // Add headers if needed, for example authorization
    // headers: {
    //   authorization: "Bearer my-token"
    // }
  }),
});

const query = gql`
  query {
    ... @defer {
      employee(id: 1) {
        id
        details {
          forename
        }
      }
    }
  }
`;

const query2 = gql`
  query {
    me {
      name
      posts {
        title
      }
      ... @defer(label: "userPosts") {
        posts {
          ... @defer(label: "postComments") {
            comments {
              text
              ... @defer {
                author
              }
            }
          }
        }
      }
      id
    }
  }
`;

const query3 = gql`
  query {
    me {
      ... @defer {
        name
      }
      id
    }
  }
`;


console.log(`Starting Apollo Client @defer request to ${ROUTER_URL}`);

const observer = client.watchQuery({
  query: query2,
  fetchPolicy: 'network-only', // ensure we fetch from network
});

observer.subscribe({
  next(result) {
    console.log("\n=============================");
    console.log(`RECEIVED UPDATE (loading: ${result.loading}):`);
    console.log(JSON.stringify(result.data, null, 2));
    console.log("=============================\n");
  },
  error(err) {
    console.error("ERROR RECEIVED:", err);
  },
  complete() {
    console.log("STREAM COMPLETED SUCCESSFULLY");
  }
});

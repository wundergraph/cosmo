import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '15s', target: 50 },
    { duration: '20s', target: 100 },
  ],
};

// oha http://localhost:3002/graphql -n 100 -z 10s -H 'content-type: application/json' -d '{"query":"  query Bench {\n    employees {\n      details {\n        forename\n      }\n    }\n}","operationName":"Bench"}'

export default function () {
  let query = `
  query benchBig {
  employees {
    # resolved through employees subgraph
    id
    # overridden by the products subgraph
    notes
    details {
      # resolved through either employees or family subgraph
      forename
      surname
      # resolved through employees subgraph
      location {
        key {
          name
        }
      }
      # resolved through family subgraph
      hasChildren
      # maritalStatus can return null
      maritalStatus
      nationality
      # pets can return null
      pets {
        class
        gender
        name
        ... on Cat {
          type
        }
        ... on Dog {
          breed
        }
        ... on Alligator {
          dangerous
        }
      }
    }
    # resolved through employees subgraph
    role {
      departments
      title
      ... on Engineer {
        engineerType
      }
      ... on Operator {
        operatorType
      }
    }
    # resolved through hobbies subgraph
    hobbies {
      ... on Exercise {
        category
      }
      ... on Flying {
        planeModels
        yearsOfExperience
      }
      ... on Gaming {
        genres
        name
        yearsOfExperience
      }
      ... on Other {
        name
      }
      ... on Programming {
        languages
      }
      ... on Travelling {
        countriesLived {
          key {
            name
          }
        }
      }
    }
    # resolved through products subgraph
    products
  }
  # can return null
  employee(id: 1) {
    # resolved through employees subgraph
    id
    details {
      forename
      location {
        key {
          name
        }
      }
    }
  }
  teammates(team: OPERATIONS) {
    # resolved through employees subgraph
    id
    ...EmployeeNameFragment
    # resolved through products subgraph
    products
  }
  productTypes {
    ... on Documentation {
      url(product: SDK)
      urls(products: [COSMO, MARKETING])
    }
    ... on Consultancy {
      lead {
        ...EmployeeNameFragment
      }
      name
    }
  }
  a: findEmployees(criteria: {
    hasPets: true, nationality: UKRAINIAN, nested: { maritalStatus: ENGAGED }
  }) {
    ...EmployeeNameFragment
  }
  b: findEmployees(criteria: {
    hasPets: true, nationality: GERMAN, nested: { maritalStatus: MARRIED, hasChildren: true }
  }) {
    ...EmployeeNameFragment
  }
}

fragment EmployeeNameFragment on Employee {
  details {
    forename
  }
}`;

  let headers = {
    'Content-Type': 'application/json',
    'GraphQL-Client-Name': 'k6',
    'GraphQL-Client-Version': '0.0.1',
  };

  let res = http.post('http://localhost:3002/graphql', JSON.stringify({ query: query, operationName: 'benchBig' }), {
    headers: headers,
  });
  check(res, {
    'is status 200': (r) => r.status === 200 && r.body.includes('errors') === false,
  });
}

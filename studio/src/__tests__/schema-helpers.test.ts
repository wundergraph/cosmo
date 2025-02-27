import { expect, test } from "vitest";
import {
  extractVariablesFromGraphQL,
  getDeprecatedTypes,
  getAuthenticatedTypes,
  getTypeCounts,
  parseSchema,
} from "../lib/schema-helpers";

const schema = `
type Query {
  employees: [Employee!]!
  teammates(team: Department! @deprecated): [Employee!]!
  findID(criteria: Criteria!): Int!
}

input Criteria {
  age: Int!
  nested: Nested
  hasPets: Boolean
}

input Nested {
  department: Department!
}

enum Department {
  ENGINEERING
  MARKETING
  OPERATIONS
}

type Employee {
  id: Int!
  firstName: String! @authenticated
  lastName: String!
  fullName: String! @deprecated(reason: "Please use first and last name instead")
}

enum Role {
  DEFAULT
}

type Staff {
  id: Int!
  firstName: String!
  role: Role! @authenticated
  email: String! @requiresScopes(scopes: [["read:profile", "read:email"], ["read:all"]])
}
`;

test("return the correct types with deprecated fields or args", () => {
  const ast = parseSchema(schema);

  expect(ast).not.toBeNull();

  const deprecated = getDeprecatedTypes(ast!);

  expect(deprecated.length).toEqual(2);
  expect(deprecated[0].fields?.length).toEqual(1);
  expect(deprecated[0].fields?.[0]?.name).toEqual("teammates");
  expect(deprecated[1].fields?.length).toEqual(1);
  expect(deprecated[1].fields?.[0]?.name).toEqual("fullName");
});

test("that authentication types are read correctly", async () => {
  const ast = await formatAndParseSchema(schema);

  expect(ast).not.toBeNull();

  const authenticated = getAuthenticatedTypes(ast!);
  expect(authenticated.length).toEqual(2);
  expect(authenticated[0].fields?.length).toEqual(1);
  expect(authenticated[0].fields?.[0]?.name).toEqual("firstName");
  expect(authenticated[1].fields?.length).toEqual(2);
  expect(authenticated[1].fields?.[0]?.name).toEqual("role");
  expect(authenticated[1].fields?.[1]?.name).toEqual("email");
  expect(authenticated[1].fields?.[1]?.requiresScopes).toStrictEqual([["read:profile", "read:email"], ["read:all"]]);
});

test("returns correct type counts", () => {
  const ast = parseSchema(schema);

  expect(ast).not.toBeNull();

  const counts = getTypeCounts(ast!);

  expect(counts["query"]).toEqual(3);
  expect(counts["objects"]).toEqual(2);
  expect(counts["enums"]).toEqual(2);
});

test("returns empty if no variables are present", () => {
  const ast = parseSchema(schema);
  expect(ast).not.toBeNull();

  const query = `
    query {
      employees {
        id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, ast);
  expect(variables).toMatchObject({});
});

test("returns multiple variables", () => {
  const ast = parseSchema(schema);
  expect(ast).not.toBeNull();

  const query = `
    query ($a: Int, $criteria: Criteria!) {
      employees {
       id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, ast);
  expect(variables).toMatchObject({
    a: 0,
    criteria: {
      age: 0,
      nested: {
        department: "ENGINEERING",
      },
    },
  });
});

test("returns multiple variables with defaults", () => {
  const ast = parseSchema(schema);
  expect(ast).not.toBeNull();

  const query = `
    query ($a: Int = 10, $criteria: Criteria = { age: 12, hasPets: true, nested: { department: "ENGINEERING" }}, $b: [Int] = [1,2,3]) {
      employees {
       id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, ast);

  expect(variables).toMatchObject({
    a: 10,
    criteria: {
      age: 12,
      nested: {
        department: "ENGINEERING",
      },
      hasPets: true,
    },
    b: [1, 2, 3],
  });
});

test("returns nested variables", () => {
  const ast = parseSchema(schema);
  expect(ast).not.toBeNull();

  const query = `
    query ($criteria: Criteria) {
      findID(criteria: $criteria)
    }
  `;

  const variables = extractVariablesFromGraphQL(query, ast);
  expect(variables).toMatchObject({
    criteria: {
      age: 0,
      nested: {
        department: "ENGINEERING",
      },
    },
  });
});

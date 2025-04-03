import { expect, test } from "vitest";
import {
  extractVariablesFromGraphQL,
  getDeprecatedTypes,
  getAuthenticatedTypes,
  getTypeCounts,
  parseSchema,
  getParsedTypes,
} from "../lib/schema-helpers";
import { parse } from "graphql";

const schema = `
type Query {
  employees: [Employee!]!
  teammates(team: Department! @deprecated(reason: "test")): [Employee!]!
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

enum Role @authenticated {
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
  const result = parseSchema(schema);

  expect(result).not.toBeNull();

  const parsedTypes = getParsedTypes(result!.doc);
  const [totalDeprecatedNodesCount, deprecated] = getDeprecatedTypes(parsedTypes);

  expect(totalDeprecatedNodesCount).toEqual(2);
  expect(deprecated.length).toEqual(2);
  expect(deprecated[0].fields?.length).toEqual(1);
  expect(deprecated[0].fields?.[0]?.name).toEqual("teammates");
  expect(deprecated[1].fields?.length).toEqual(1);
  expect(deprecated[1].fields?.[0]?.name).toEqual("fullName");
  expect(deprecated[1].fields?.[0]?.deprecationReason).toEqual("Please use first and last name instead");
});

test("that authentication types are read correctly", async () => {
  const result = await parseSchema(schema);

  expect(result).not.toBeNull();

  const parsedTypes = getParsedTypes(result!.doc);
  const [totalAuthenticatedNodesCount, authenticatedTypes] = getAuthenticatedTypes(parsedTypes);

  expect(totalAuthenticatedNodesCount).toEqual(4);
  expect(authenticatedTypes.length).toEqual(3);
  expect(authenticatedTypes[0].fields?.length).toEqual(1);
  expect(authenticatedTypes[0].fields?.[0]?.name).toEqual("firstName");
  expect(authenticatedTypes[1].name).toEqual("Role");
  expect(authenticatedTypes[2].fields?.length).toEqual(2);
  expect(authenticatedTypes[2].fields?.[0]?.name).toEqual("role");
  expect(authenticatedTypes[2].fields?.[1]?.name).toEqual("email");
  expect(authenticatedTypes[2].fields?.[1]?.requiresScopes).toStrictEqual([["read:profile", "read:email"], ["read:all"]]);
});

test("returns correct type counts", () => {
  const result = parseSchema(schema);

  expect(result).not.toBeNull();

  const counts = getTypeCounts(result!.ast);

  expect(counts["query"]).toEqual(3);
  expect(counts["objects"]).toEqual(2);
  expect(counts["enums"]).toEqual(2);
});

test("returns empty if no variables are present", () => {
  const result = parseSchema(schema);
  expect(result).not.toBeNull();

  const query = `
    query {
      employees {
        id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, result!.ast);
  expect(variables).toMatchObject({});
});

test("returns multiple variables", () => {
  const result = parseSchema(schema);
  expect(result).not.toBeNull();

  const query = `
    query ($a: Int, $criteria: Criteria!) {
      employees {
       id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, result!.ast);
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
  const result = parseSchema(schema);
  expect(result).not.toBeNull();

  const query = `
    query ($a: Int = 10, $criteria: Criteria = { age: 12, hasPets: true, nested: { department: "ENGINEERING" }}, $b: [Int] = [1,2,3]) {
      employees {
       id
      }
    }
  `;

  const variables = extractVariablesFromGraphQL(query, result!.ast);

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
  const result = parseSchema(schema);
  expect(result).not.toBeNull();

  const query = `
    query ($criteria: Criteria) {
      findID(criteria: $criteria)
    }
  `;

  const variables = extractVariablesFromGraphQL(query, result!.ast);
  expect(variables).toMatchObject({
    criteria: {
      age: 0,
      nested: {
        department: "ENGINEERING",
      },
    },
  });
});

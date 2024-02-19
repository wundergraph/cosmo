import { parse, OperationDefinitionNode, Kind } from "graphql";
import {
  getDeprecatedTypes,
  getTypeCounts,
  formatAndParseSchema,
  extractVariablesFromGraphQL,
  parseSchema,
} from "../lib/schema-helpers";
import { expect, test } from "vitest";

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
  firstName: String!
  lastName: String!
  fullName: String! @deprecated(reason: "Please use first and last name instead")
}
`;

test("return the correct types with deprecated fields or args", async () => {
  const ast = await formatAndParseSchema(schema);

  expect(ast).not.toBeNull();

  const deprecated = getDeprecatedTypes(ast!);

  expect(deprecated.length).toEqual(2);
  expect(deprecated[0].fields?.length).toEqual(1);
  expect(deprecated[0].fields?.[0]?.name).toEqual("teammates");
  expect(deprecated[1].fields?.length).toEqual(1);
  expect(deprecated[1].fields?.[0]?.name).toEqual("fullName");
});

test("returns correct type counts", () => {
  const ast = parseSchema(schema);

  expect(ast).not.toBeNull();

  const counts = getTypeCounts(ast!);

  expect(counts["query"]).toEqual(3);
  expect(counts["objects"]).toEqual(1);
  expect(counts["enums"]).toEqual(1);
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

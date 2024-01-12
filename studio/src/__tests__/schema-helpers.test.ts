import {
  getDeprecatedTypes,
  getTypeCounts,
  parseSchema,
} from "../lib/schema-helpers";
import { expect, test } from "vitest";

const schema = `
type Query {
  employees: [Employee!]!
  teammates(team: Department! @deprecated): [Employee!]!
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
  const ast = await parseSchema(schema);

  expect(ast).not.toBeNull();

  const deprecated = getDeprecatedTypes(ast!);

  expect(deprecated.length).toEqual(2);
  expect(deprecated[0].fields?.length).toEqual(1);
  expect(deprecated[0].fields?.[0]?.name).toEqual("teammates");
  expect(deprecated[1].fields?.length).toEqual(1);
  expect(deprecated[1].fields?.[0]?.name).toEqual("fullName");
});

test("returns correct type counts", async () => {
  const ast = await parseSchema(schema);

  expect(ast).not.toBeNull();

  const counts = await getTypeCounts(ast!);

  expect(counts["query"]).toEqual(2);
  expect(counts["objects"]).toEqual(1);
  expect(counts["enums"]).toEqual(1);
});

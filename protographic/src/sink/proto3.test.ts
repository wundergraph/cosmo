import { describe, it, expect } from "bun:test";
import { intoProto3, printProto3 } from "./proto3";
import { type Service } from "@/common/service";

describe("proto3 Sink", () => {
  const svc: Service = {
    messages: [
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "price",
            resolved: false,
            type: {
              list: false,
              name: "Float",
              required: true,
            },
          },
        ],
        name: "Product",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "location",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "Storage",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "User",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "b",
            resolved: false,
            type: {
              list: false,
              name: "NestedTypeB",
              required: true,
            },
          },
        ],
        name: "NestedTypeA",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "c",
            resolved: false,
            type: {
              list: false,
              name: "NestedTypeC",
              required: true,
            },
          },
        ],
        name: "NestedTypeB",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "NestedTypeC",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "recursiveType",
            resolved: false,
            type: {
              list: false,
              name: "RecursiveType",
              required: true,
            },
          },
        ],
        name: "RecursiveType",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField1",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField2",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "TypeWithMultipleFilterFields",
      },
      {
        fields: [
          {
            name: "filterField1",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField2",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "FilterTypeInput",
      },
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "TypeWithComplexFilterInput",
      },
      {
        fields: [
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField1",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField2",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "pagination",
            resolved: false,
            type: {
              list: false,
              name: "Pagination",
              required: false,
            },
          },
        ],
        name: "FilterType",
      },
      {
        fields: [
          {
            name: "page",
            resolved: false,
            type: {
              list: false,
              name: "Int",
              required: true,
            },
          },
          {
            name: "perPage",
            resolved: false,
            type: {
              list: false,
              name: "Int",
              required: true,
            },
          },
        ],
        name: "Pagination",
      },
      {
        fields: [
          {
            name: "filter",
            resolved: false,
            type: {
              list: false,
              name: "FilterType",
              required: true,
            },
          },
        ],
        name: "ComplexFilterTypeInput",
      },
      {
        fields: [
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "price",
            resolved: false,
            type: {
              list: false,
              name: "Float",
              required: true,
            },
          },
        ],
        name: "CreateProductInput",
      },
    ],
    name: "MyService",
    rpcs: [
      {
        arguments: [
          {
            name: "representations",
            resolved: false,
            type: {
              list: true,
              name: "_Any",
              required: true,
            },
          },
        ],
        name: "_entities",
        kind: "Query",
        type: {
          list: true,
          name: "_Entity",
          required: true,
        },
      },
      {
        arguments: [],
        name: "users",
        kind: "Query",
        type: {
          list: true,
          name: "User",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
        ],
        name: "user",
        kind: "Query",
        type: {
          list: false,
          name: "User",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: false,
            },
          },
        ],
        name: "userIdOptional",
        kind: "Query",
        type: {
          list: false,
          name: "User",
          required: false,
        },
      },
      {
        arguments: [],
        name: "nestedType",
        kind: "Query",
        type: {
          list: true,
          name: "NestedTypeA",
          required: true,
        },
      },
      {
        arguments: [],
        name: "recursiveType",
        kind: "Query",
        type: {
          list: false,
          name: "RecursiveType",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "filterField1",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField2",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "typeFilterWithArguments",
        kind: "Query",
        type: {
          list: true,
          name: "TypeWithMultipleFilterFields",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "filter",
            resolved: false,
            type: {
              list: false,
              name: "FilterTypeInput",
              required: true,
            },
          },
        ],
        name: "typeWithMultipleFilterFields",
        kind: "Query",
        type: {
          list: true,
          name: "TypeWithMultipleFilterFields",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "filter",
            resolved: false,
            type: {
              list: false,
              name: "ComplexFilterTypeInput",
              required: true,
            },
          },
        ],
        name: "complexFilterType",
        kind: "Query",
        type: {
          list: true,
          name: "TypeWithComplexFilterInput",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "input",
            resolved: false,
            type: {
              list: false,
              name: "CreateProductInput",
              required: true,
            },
          },
        ],
        name: "createProduct",
        kind: "Mutation",
        type: {
          list: false,
          name: "Product",
          required: true,
        },
      },
    ],
  };

  const { proto, mapping } = intoProto3(svc);

  it("should generate a valid proto3 ast", () => {
    expect(proto).toMatchSnapshot();
  });

  it("should generate a valid proto3 mapping", () => {
    expect(mapping).toMatchSnapshot();
  });

  it("should print correct proto3 syntax", () => {
    const printed = printProto3(proto);

    expect(printed).toMatchSnapshot();
  });
});

describe("simple mapping case", () => {
  const svc: Service = {
    messages: [
      {
        fields: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
        ],
        name: "User",
      },
      {
        fields: [
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField1",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "filterField2",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "pagination",
            resolved: false,
            type: {
              list: false,
              name: "Pagination",
              required: false,
            },
          },
        ],
        name: "FilterType",
      },
      {
        fields: [
          {
            name: "page",
            resolved: false,
            type: {
              list: false,
              name: "Int",
              required: true,
            },
          },
          {
            name: "perPage",
            resolved: false,
            type: {
              list: false,
              name: "Int",
              required: true,
            },
          },
        ],
        name: "Pagination",
      },
      {
        fields: [
          {
            name: "filter",
            resolved: false,
            type: {
              list: false,
              name: "FilterType",
              required: true,
            },
          },
        ],
        name: "ComplexFilterTypeInput",
      },
      {
        fields: [
          {
            name: "name",
            resolved: false,
            type: {
              list: false,
              name: "String",
              required: true,
            },
          },
          {
            name: "price",
            resolved: false,
            type: {
              list: false,
              name: "Float",
              required: true,
            },
          },
        ],
        name: "CreateProductInput",
      },
    ],
    name: "ProductService",
    rpcs: [
      {
        arguments: [],
        kind: "Query",
        name: "users",
        type: {
          list: true,
          name: "User",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "id",
            resolved: false,
            type: {
              list: false,
              name: "ID",
              required: true,
            },
          },
        ],
        kind: "Query",
        name: "user",
        type: {
          list: false,
          name: "User",
          required: false,
        },
      },
      {
        arguments: [
          {
            name: "filter",
            resolved: false,
            type: {
              list: false,
              name: "ComplexFilterTypeInput",
              required: true,
            },
          },
        ],
        kind: "Query",
        name: "complexFilterType",
        type: {
          list: true,
          name: "TypeWithComplexFilterInput",
          required: true,
        },
      },
      {
        arguments: [
          {
            name: "input",
            resolved: false,
            type: {
              list: false,
              name: "CreateProductInput",
              required: true,
            },
          },
        ],
        kind: "Mutation",
        name: "createUser",
        type: {
          list: false,
          name: "Product",
          required: true,
        },
      },
      {
        arguments: [],
        kind: "Subscription",
        name: "subscribeUsers",
        type: {
          list: false,
          name: "User",
          required: true,
        },
      },
    ],
  };

  const { mapping } = intoProto3(svc);

  it("should generate a valid proto3 mapping", () => {
    expect(mapping).toMatchSnapshot();
  });
});

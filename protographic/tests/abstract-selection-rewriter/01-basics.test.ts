import { describe, expect, it } from 'vitest';
import { buildSchema, parse, print, GraphQLObjectType } from 'graphql';
import { AbstractSelectionRewriter } from '../../src/abstract-selection-rewriter.js';

const schema = buildSchema(
  `
  type Query {
    media: [Media]
    library: Library
  }

  interface Media {
    id: ID!
    title: String
  }

  type Book implements Media {
    id: ID!
    title: String
    author: String
  }

  type Movie implements Media {
    id: ID!
    title: String
    director: String
  }

  type Library {
    name: String
    items: [Media]
  }
`,
  {
    assumeValid: true,
    assumeValidSDL: true,
  },
);


/**
 * Helper function to normalize a field set selection
 */
function normalizeFieldSet(fieldSet: string, typeName: string): string {
  const doc = parse(`{ ${fieldSet} }`);
  const objectType = schema.getTypeMap()[typeName] as GraphQLObjectType;
  const rewriter = new AbstractSelectionRewriter(doc, schema, objectType);
  rewriter.normalize();
  return print(doc);
}


function normalizeFieldSetWithComplexInterfaces(fieldSet: string, typeName: string): string {
  const doc = parse(`{ ${fieldSet} }`);
  const objectType = schemaWithComplexInterfaces.getTypeMap()[typeName] as GraphQLObjectType;
  const rewriter = new AbstractSelectionRewriter(doc, schemaWithComplexInterfaces, objectType);
  rewriter.normalize();
  return print(doc);
}

const schemaWithDeepNesting = buildSchema(
  `
  type Query {
    root: Root
  }

  type Root {
    level1: [Level1Interface]
  }

  interface Level1Interface {
    id: ID!
    level2: [Level2Interface]
  }

  interface Level2Interface {
    name: String
  }

  type Level1TypeA implements Level1Interface {
    id: ID!
    level2: [Level2Interface]
    dataA: String
  }

  type Level1TypeB implements Level1Interface {
    id: ID!
    level2: [Level2Interface]
    dataB: String
  }

  type Level1TypeC implements Level1Interface {
    id: ID!
    level2: [Level2TypeX]
    dataC: String
  }

  type Level2TypeX implements Level2Interface {
    name: String
    valueX: Int
  }

  type Level2TypeY implements Level2Interface {
    name: String
    valueY: Float
  }
`,
  {
    assumeValid: true,
    assumeValidSDL: true,
  },
);

describe('AbstractSelectionRewriter', () => {
  it('should distribute interface field to all inline fragments', () => {
    const input = `
      media {
        id
        ... on Book { author }
        ... on Movie { director }
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        media {
          ... on Book {
            id
            author
          }
          ... on Movie {
            id
            director
          }
        }
      }"
    `);
  });

  it('should preserve existing fields in fragments (no duplicates)', () => {
    const input = `
      media {
        id
        ... on Book { id author }
        ... on Movie { director }
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        media {
          ... on Book {
            id
            author
          }
          ... on Movie {
            id
            director
          }
        }
      }"
    `);
  });

  it('should handle nested interface selections', () => {
    const input = `
      library {
        name
        items {
          id
          ... on Book { author }
          ... on Movie { director }
        }
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        library {
          name
          items {
            ... on Book {
              id
              author
            }
            ... on Movie {
              id
              director
            }
          }
        }
      }"
    `);
  });

  it('should be no-op for object type selections', () => {
    const input = `
      library {
        name
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        library {
          name
        }
      }"
    `);
  });

  it('should handle multiple interface fields', () => {
    const input = `
      media {
        id
        title
        ... on Book { author }
        ... on Movie { director }
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        media {
          ... on Book {
            id
            title
            author
          }
          ... on Movie {
            id
            title
            director
          }
        }
      }"
    `);
  });

  it('should handle empty interface-level fields (fragments only)', () => {
    const input = `
      media {
        ... on Book { id author }
        ... on Movie { id director }
      }
    `;

    const result = normalizeFieldSet(input, 'Query');

    expect(result).toMatchInlineSnapshot(`
      "{
        media {
          ... on Book {
            id
            author
          }
          ... on Movie {
            id
            director
          }
        }
      }"
    `);
  });

  it('should handle deeply nested interfaces', () => {
    const input = `
      root {
        level1 {
          id
          level2 {
            name
            ... on Level2TypeX { valueX }
            ... on Level2TypeY { valueY }
          }
          ... on Level1TypeA { dataA }
          ... on Level1TypeB { dataB }
          ... on Level1TypeC { dataC }
        }
      }
    `;

    const doc = parse(`{ ${input} }`);
    const objectType = schemaWithDeepNesting.getTypeMap().Query as GraphQLObjectType;
    const rewriter = new AbstractSelectionRewriter(doc, schemaWithDeepNesting, objectType);
    rewriter.normalize();
    const result = print(doc);

    expect(result).toMatchInlineSnapshot(`
      "{
        root {
          level1 {
            ... on Level1TypeA {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataA
            }
            ... on Level1TypeB {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataB
            }
            ... on Level1TypeC {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataC
            }
          }
        }
      }"
    `);
  });

  it('should handle interface field narrowed to concrete type', () => {
    const input = `
      root {
        level1 {
          id
          level2 {
            name
            ... on Level2TypeX { valueX }
            ... on Level2TypeY { valueY }
          }
          ... on Level1TypeA { dataA }
          ... on Level1TypeB { dataB }
          ... on Level1TypeC { dataC }
        }
      }
    `;

    const doc = parse(`{ ${input} }`);
    const objectType = schemaWithDeepNesting.getTypeMap().Query as GraphQLObjectType;
    const rewriter = new AbstractSelectionRewriter(doc, schemaWithDeepNesting, objectType);
    rewriter.normalize();
    const result = print(doc);

    expect(result).toMatchInlineSnapshot(`
      "{
        root {
          level1 {
            ... on Level1TypeA {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataA
            }
            ... on Level1TypeB {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataB
            }
            ... on Level1TypeC {
              id
              level2 {
                ... on Level2TypeX {
                  name
                  valueX
                }
              }
              dataC
            }
          }
        }
      }"
    `);
  });
});


const schemaWithComplexInterfaces = buildSchema(
  `
  interface Iface {
    title: String
  }

  interface Iface2 {
    name: String
  }

  type A implements Iface {
    title: String
  }

  type B implements Iface & Iface2 {
    title: String
    name: String
    otherB: String
  }

  type C implements Iface2 {
    name: String
    otherC: String
  }

  type Query {
    iface: Iface
  }
  `, {
    assumeValid: true,
    assumeValidSDL: true,
  }
)

describe('AbstractSelectionRewriter', () => {
  it('should handle complex interfaces', () => {
    const input = `
    iface {
      ... on Iface2 {
        name
        ... on B {
          otherB
        }
        ... on C {
          otherC
        }   
      }
    }
    `;

    const result = normalizeFieldSetWithComplexInterfaces(input, 'Query');
    expect(result).toMatchInlineSnapshot(`
      "{
        iface {
          ... on B {
            name
            otherB
          }
        }
      }"
    `);
  });

  it('should handle fields on multiple levels of interfaces', () => {
    const input = `
    iface {
      title
      ... on Iface2 {
        name
        ... on B {
          otherB
        }
        ... on C {
          otherC
        }   
      }
    }
    `;

    const result = normalizeFieldSetWithComplexInterfaces(input, 'Query');
    expect(result).toMatchInlineSnapshot(`
      "{
        iface {
          ... on A {
            title
          }
          ... on B {
            title
            name
            otherB
          }
        }
      }"
    `);
  })
});
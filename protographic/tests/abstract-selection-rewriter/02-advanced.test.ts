import { describe, expect, it } from 'vitest';
import { buildSchema, parse, print, GraphQLObjectType } from 'graphql';
import { AbstractSelectionRewriter } from '../../src/abstract-selection-rewriter.js';

const advancedSchema = buildSchema(
  `
  type Query {
    organization: Organization
    departments: [Department]
  }

  type Organization {
    name: String
    departments: [Department]
  }

  type Department {
    title: String
    members: [Employee]
  }

  interface Employee {
    id: ID!
    name: String
  }

  interface Managed {
    supervisor: String
  }

  interface Permission {
    scope: String
  }

  interface Project {
    projectId: ID!
    deadline: String
  }

  interface Funded {
    budget: Float
  }

  interface Assigned {
    assignee: Employee
    priority: Int
  }

  type Manager implements Employee {
    id: ID!
    name: String
    reports: [Employee]
    projects: [Project]
    level: Int
  }

  type Engineer implements Employee & Managed {
    id: ID!
    name: String
    supervisor: String
    specialty: String
  }

  type Contractor implements Employee & Managed & Permission {
    id: ID!
    name: String
    supervisor: String
    scope: String
    agency: String
  }

  type Intern implements Employee & Permission {
    id: ID!
    name: String
    scope: String
    school: String
  }

  type SideProject implements Project {
    projectId: ID!
    deadline: String
    description: String
  }

  type InternalProject implements Project & Assigned {
    projectId: ID!
    deadline: String
    assignee: Employee
    priority: Int
    department: String
  }

  type ExternalProject implements Project & Funded & Assigned {
    projectId: ID!
    deadline: String
    budget: Float
    assignee: Employee
    priority: Int
    client: String
  }

  type ResearchProject implements Project & Funded {
    projectId: ID!
    deadline: String
    budget: Float
    field: String
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
  const objectType = advancedSchema.getTypeMap()[typeName] as GraphQLObjectType;
  const rewriter = new AbstractSelectionRewriter(doc, advancedSchema, objectType);
  rewriter.normalize();
  return print(doc);
}

describe('AbstractSelectionRewriter - Advanced Cases', () => {
  describe('Via departments (shallower nesting)', () => {
    it('should distribute interface fields through one object type level', () => {
      const input = `
        departments {
          members {
            id
            ... on Manager { level }
            ... on Engineer { specialty }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Contractor {
                id
              }
              ... on Intern {
                id
              }
              ... on Manager {
                id
                level
              }
              ... on Engineer {
                id
                specialty
              }
            }
          }
        }"
      `);
    });

    it('should handle nested interface selection (... on Managed inside Employee)', () => {
      const input = `
        departments {
          members {
            ... on Managed {
              supervisor
              ... on Engineer { specialty }
              ... on Contractor { agency }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Engineer {
                supervisor
                specialty
              }
              ... on Contractor {
                supervisor
                agency
              }
            }
          }
        }"
      `);
    });

    it('should distribute fields at both interface levels', () => {
      const input = `
        departments {
          members {
            id
            ... on Managed {
              supervisor
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                id
              }
              ... on Engineer {
                id
                supervisor
              }
              ... on Contractor {
                id
                supervisor
              }
              ... on Intern {
                id
              }
            }
          }
        }"
      `);
    });

    it('should handle nested interface selection on Permission', () => {
      const input = `
        departments {
          members {
            ... on Permission {
              scope
              ... on Contractor { agency }
              ... on Intern { school }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Contractor {
                scope
                agency
              }
              ... on Intern {
                scope
                school
              }
            }
          }
        }"
      `);
    });

    it('should handle two nested interface selections (Managed + Permission)', () => {
      const input = `
        departments {
          members {
            id
            ... on Managed {
              supervisor
            }
            ... on Permission {
              scope
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                id
              }
              ... on Engineer {
                id
                supervisor
              }
              ... on Contractor {
                id
                supervisor
                scope
              }
              ... on Intern {
                id
                scope
              }
            }
          }
        }"
      `);
    });

    it('should handle deeply nested interface intersections', () => {
      const input = `
        departments {
          members {
            ... on Permission {
              scope
              ... on Managed {
                supervisor
                ... on Employee {
                  name
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Contractor {
                scope
                supervisor
                name
              }
              ... on Intern {
                scope
              }
            }
          }
        }"
      `);
    });

    it('should handle multiple nested interface intersection paths', () => {
      const input = `
        departments {
          members {
            id
            ... on Managed {
              supervisor
              ... on Permission {
                scope
              }
            }
            ... on Permission {
              scope
              ... on Managed {
                supervisor
                ... on Employee {
                  name
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                id
              }
              ... on Engineer {
                id
                supervisor
              }
              ... on Contractor {
                id
                supervisor
                scope
                name
              }
              ... on Intern {
                id
                scope
              }
            }
          }
        }"
      `);
    });
  });

  describe('Via organization (deep nesting)', () => {
    it('should distribute interface fields through deep nesting', () => {
      const input = `
        organization {
          name
          departments {
            members {
              id
              ... on Manager { level }
              ... on Engineer { specialty }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          organization {
            name
            departments {
              members {
                ... on Contractor {
                  id
                }
                ... on Intern {
                  id
                }
                ... on Manager {
                  id
                  level
                }
                ... on Engineer {
                  id
                  specialty
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle nested interface selection through deep nesting', () => {
      const input = `
        organization {
          name
          departments {
            members {
              ... on Managed {
                supervisor
                ... on Engineer { specialty }
                ... on Contractor { agency }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          organization {
            name
            departments {
              members {
                ... on Engineer {
                  supervisor
                  specialty
                }
                ... on Contractor {
                  supervisor
                  agency
                }
              }
            }
          }
        }"
      `);
    });
  });

  describe('Recursive interface field', () => {
    it('should normalize interface field on concrete type inside fragment', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              reports {
                id
                ... on Engineer { specialty }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                reports {
                  ... on Manager {
                    id
                  }
                  ... on Contractor {
                    id
                  }
                  ... on Intern {
                    id
                  }
                  ... on Engineer {
                    id
                    specialty
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize nested Managed interface selection within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              reports {
                id
                ... on Managed {
                  supervisor
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                reports {
                  ... on Manager {
                    id
                  }
                  ... on Engineer {
                    id
                    supervisor
                  }
                  ... on Contractor {
                    id
                    supervisor
                  }
                  ... on Intern {
                    id
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize nested Permission interface selection within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              reports {
                name
                ... on Permission {
                  scope
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                reports {
                  ... on Manager {
                    name
                  }
                  ... on Engineer {
                    name
                  }
                  ... on Contractor {
                    name
                    scope
                  }
                  ... on Intern {
                    name
                    scope
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize multiple nested interface selections within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              reports {
                id
                name
                ... on Managed {
                  supervisor
                }
                ... on Permission {
                  scope
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                reports {
                  ... on Manager {
                    id
                    name
                  }
                  ... on Engineer {
                    id
                    name
                    supervisor
                  }
                  ... on Contractor {
                    id
                    name
                    supervisor
                    scope
                  }
                  ... on Intern {
                    id
                    name
                    scope
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize nested interface with concrete type selections within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              reports {
                id
                ... on Managed {
                  supervisor
                  ... on Engineer { specialty }
                  ... on Contractor { agency }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                reports {
                  ... on Manager {
                    id
                  }
                  ... on Engineer {
                    id
                    supervisor
                    specialty
                  }
                  ... on Contractor {
                    id
                    supervisor
                    agency
                  }
                  ... on Intern {
                    id
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize all interface combinations within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              level
              reports {
                ... on Managed {
                  supervisor
                  ... on Engineer { specialty }
                }
                ... on Permission {
                  scope
                  ... on Intern { school }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                level
                reports {
                  ... on Contractor {
                    supervisor
                    scope
                  }
                  ... on Engineer {
                    supervisor
                    specialty
                  }
                  ... on Intern {
                    scope
                    school
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize Manager.reports with sub-interface selections', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              level
              reports {
                id
                ... on Managed {
                  supervisor
                }
                ... on Engineer {
                  specialty
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                level
                reports {
                  ... on Manager {
                    id
                  }
                  ... on Contractor {
                    id
                    supervisor
                  }
                  ... on Intern {
                    id
                  }
                  ... on Engineer {
                    supervisor
                    id
                    specialty
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize Manager.reports with mixed sub-interfaces and concrete types', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              level
              reports {
                name
                ... on Managed {
                  supervisor
                }
                ... on Permission {
                  scope
                }
                ... on Contractor {
                  agency
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                level
                reports {
                  ... on Manager {
                    name
                  }
                  ... on Engineer {
                    name
                    supervisor
                  }
                  ... on Intern {
                    name
                    scope
                  }
                  ... on Contractor {
                    supervisor
                    scope
                    name
                    agency
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should normalize multiple levels of recursive Manager.reports with incremental types', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              level
              reports {
                id
                ... on Manager {
                  level
                  reports {
                    id
                    name
                    ... on Manager {
                      level
                      reports {
                        id
                        name
                        ... on Manager { level }
                        ... on Engineer { specialty }
                        ... on Intern { school }
                      }
                    }
                    ... on Engineer {
                      specialty
                    }
                  }
                }
                ... on Engineer {
                  specialty
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                level
                reports {
                  ... on Contractor {
                    id
                  }
                  ... on Intern {
                    id
                  }
                  ... on Manager {
                    id
                    level
                    reports {
                      ... on Contractor {
                        id
                        name
                      }
                      ... on Intern {
                        id
                        name
                      }
                      ... on Manager {
                        id
                        name
                        level
                        reports {
                          ... on Contractor {
                            id
                            name
                          }
                          ... on Manager {
                            id
                            name
                            level
                          }
                          ... on Engineer {
                            id
                            name
                            specialty
                          }
                          ... on Intern {
                            id
                            name
                            school
                          }
                        }
                      }
                      ... on Engineer {
                        id
                        name
                        specialty
                      }
                    }
                  }
                  ... on Engineer {
                    id
                    specialty
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle multiple nested interface intersections within Manager.reports', () => {
      const input = `
        departments {
          members {
            ... on Employee {
              id
              name
              ... on Manager {
                level
                reports {
                  id
                  ... on Managed {
                    supervisor
                    ... on Permission {
                      scope
                    }
                  }
                  ... on Permission {
                    scope
                    ... on Managed {
                      supervisor
                      ... on Employee {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Engineer {
                id
                name
              }
              ... on Contractor {
                id
                name
              }
              ... on Intern {
                id
                name
              }
              ... on Manager {
                id
                name
                level
                reports {
                  ... on Manager {
                    id
                  }
                  ... on Engineer {
                    id
                    supervisor
                  }
                  ... on Contractor {
                    id
                    supervisor
                    scope
                    name
                  }
                  ... on Intern {
                    id
                    scope
                  }
                }
              }
            }
          }
        }"
      `);
    });
  });

  describe('Different interface on concrete type field', () => {
    it('should normalize different interface field independently', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              projects {
                projectId
                ... on InternalProject { department }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on ExternalProject {
                    projectId
                  }
                  ... on ResearchProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                    department
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle sub-interface selection on different interface', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              projects {
                projectId
                ... on Funded {
                  budget
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                  }
                  ... on ExternalProject {
                    projectId
                    budget
                  }
                  ... on ResearchProject {
                    projectId
                    budget
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should isolate Employee and Project interface normalizations', () => {
      const input = `
        departments {
          members {
            id
            ... on Manager {
              projects {
                projectId
                ... on Funded {
                  budget
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Engineer {
                id
              }
              ... on Contractor {
                id
              }
              ... on Intern {
                id
              }
              ... on Manager {
                id
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                  }
                  ... on ExternalProject {
                    projectId
                    budget
                  }
                  ... on ResearchProject {
                    projectId
                    budget
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle complex intersections across different interface hierarchies', () => {
      const input = `
        departments {
          members {
            id
            ... on Managed {
              supervisor
            }
            ... on Manager {
              projects {
                projectId
                ... on Funded {
                  budget
                  ... on Project {
                    deadline
                  }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Engineer {
                id
                supervisor
              }
              ... on Contractor {
                id
                supervisor
              }
              ... on Intern {
                id
              }
              ... on Manager {
                id
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                  }
                  ... on ExternalProject {
                    projectId
                    budget
                    deadline
                  }
                  ... on ResearchProject {
                    projectId
                    budget
                    deadline
                  }
                }
              }
            }
          }
        }"
      `);
    });
  });

  describe('Complex Project interface intersections', () => {
    it('should handle multiple nested interface intersections within Manager.projects', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              projects {
                projectId
                ... on Funded {
                  budget
                  ... on Assigned {
                    priority
                  }
                }
                ... on Assigned {
                  priority
                  ... on Funded {
                    budget
                    ... on Project {
                      deadline
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                    priority
                  }
                  ... on ExternalProject {
                    projectId
                    budget
                    priority
                    deadline
                  }
                  ... on ResearchProject {
                    projectId
                    budget
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle Employee -> Project -> Employee recursion', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              projects {
                projectId
                ... on Assigned {
                  assignee {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                projects {
                  ... on SideProject {
                    projectId
                  }
                  ... on InternalProject {
                    projectId
                    assignee {
                      ... on Manager {
                        id
                        name
                      }
                      ... on Engineer {
                        id
                        name
                      }
                      ... on Contractor {
                        id
                        name
                      }
                      ... on Intern {
                        id
                        name
                      }
                    }
                  }
                  ... on ExternalProject {
                    projectId
                    assignee {
                      ... on Manager {
                        id
                        name
                      }
                      ... on Engineer {
                        id
                        name
                      }
                      ... on Contractor {
                        id
                        name
                      }
                      ... on Intern {
                        id
                        name
                      }
                    }
                  }
                  ... on ResearchProject {
                    projectId
                  }
                }
              }
            }
          }
        }"
      `);
    });

    it('should handle deep recursion with nested interface intersections', () => {
      const input = `
        departments {
          members {
            ... on Manager {
              projects {
                ... on Assigned {
                  assignee {
                    ... on Managed {
                      supervisor
                    }
                    ... on Manager {
                      projects {
                        projectId
                        ... on Funded {
                          budget
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result = normalizeFieldSet(input, 'Query');

      expect(result).toMatchInlineSnapshot(`
        "{
          departments {
            members {
              ... on Manager {
                projects {
                  ... on InternalProject {
                    assignee {
                      ... on Engineer {
                        supervisor
                      }
                      ... on Contractor {
                        supervisor
                      }
                      ... on Manager {
                        projects {
                          ... on SideProject {
                            projectId
                          }
                          ... on InternalProject {
                            projectId
                          }
                          ... on ExternalProject {
                            projectId
                            budget
                          }
                          ... on ResearchProject {
                            projectId
                            budget
                          }
                        }
                      }
                    }
                  }
                  ... on ExternalProject {
                    assignee {
                      ... on Engineer {
                        supervisor
                      }
                      ... on Contractor {
                        supervisor
                      }
                      ... on Manager {
                        projects {
                          ... on SideProject {
                            projectId
                          }
                          ... on InternalProject {
                            projectId
                          }
                          ... on ExternalProject {
                            projectId
                            budget
                          }
                          ... on ResearchProject {
                            projectId
                            budget
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }"
      `);
    });
  });
});

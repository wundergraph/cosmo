import { describe, expect, test } from 'vitest';
import { parse } from 'graphql';
import {
  CONFIGURE_DESCRIPTION,
  configureDescriptionNoDescriptionError,
  configureDescriptionPropagationError,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  ENUM,
  federateSubgraphs,
  FG_DESCRIPTION_OVERRIDE,
  FIRST_ORDINAL,
  INTERFACE,
  invalidArgumentValueErrorMessageV2,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  normalizeSubgraph,
  PROPAGATE_TO_FG,
  QUERY,
  SCALAR,
  STRING_SCALAR,
  Subgraph,
  UNION,
} from '../src';
import {
  baseDirectiveDefinitionWithConfigureDescription,
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('@openfed__configureDescription tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if the directive is repeated', () => {
      const { errors } = normalizeSubgraph(na.definitions, na.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(CONFIGURE_DESCRIPTION),
        ]),
      );
    });

    test('that an error is returned if the directive arguments are repeated', () => {
      const { errors } = normalizeSubgraph(nb.definitions, nb.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          duplicateDirectiveArgumentDefinitionsErrorMessage([PROPAGATE_TO_FG]),
        ]),
      );
    });

    test('that an error is returned if no description nor arguments are defined', () => {
      const { errors } = normalizeSubgraph(nc.definitions, nc.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });

    test('that an error is returned if propagateToFederatedGraph receives a non-boolean value', () => {
      const { errors } = normalizeSubgraph(nd.definitions, nd.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessageV2('1', CONFIGURE_DESCRIPTION, PROPAGATE_TO_FG, 'Boolean!'),
        ]),
      );
    });

    test('that an error is returned if federatedGraphDescriptionOverride receives a non-string value', () => {
      const { errors } = normalizeSubgraph(ne.definitions, ne.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessageV2('1', CONFIGURE_DESCRIPTION, FG_DESCRIPTION_OVERRIDE, STRING_SCALAR),
        ]),
      );
    });

    test('that an extension with a directive can occur before the description is defined', () => {
      const { errors, normalizationResult } = normalizeSubgraph(nf.definitions, nf.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitionWithConfigureDescription +
            `
          """
          nf.Query
          """
          type Query @openfed__configureDescription(federatedGraphDescriptionOverride: "nf.Query override") {
            dummy: String!
          }

          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if propagateToFederatedGraph is true and no description nor override value is defined #1', () => {
      const { errors } = normalizeSubgraph(ng.definitions, ng.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });

    test('that an error is returned if propagateToFederatedGraph is false and no description nor override value is defined #1', () => {
      const { errors } = normalizeSubgraph(nh.definitions, nh.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });
  });

  describe('Federation tests', () => {
    // Object
    test('that an Object description is propagated to the federated graph', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faa, fab]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fab.Query
        """
        type Query {
          """
          faa.Query.dummy description dolorem ipsum
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Object extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faa, fac]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fac.Query extension
        """
        type Query {
          """
          faa.Query.dummy description dolorem ipsum
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Object extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faa, fad]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fad.Query extension
          """
          type Query {
            """
            faa.Query.dummy description dolorem ipsum
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Object attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fab, fae]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(QUERY, [fab.name, fae.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that an Object description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faa, faf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          faa.Query description dolorem ipsum
          """
          type Query {
            """
            faa.Query.dummy description dolorem ipsum
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an Object instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faf, fag]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            faf.Query.dummy description
            """
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that all Object instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([faf, fah]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            faf.Query.dummy description
            """
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    // Interface
    test('that an Interface description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([fba, fbb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fbb.Interface description
        """
        interface Interface {
          """
          fba.Interface.name description dolorem ipsum
          """
          name: String!  
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Interface extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fba, fbc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fbc.Interface extension
          """
          interface Interface {
            """
            fba.Interface.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Interface extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fba, fbd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fbd.Interface extension
          """
          interface Interface {
            """
            fba.Interface.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Interface attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fbb, fbe]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(INTERFACE, [fbb.name, fbe.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that an Interface description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fba, fbf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fba.Interface description dolorem ipsum
          """
          interface Interface {
            """
            fba.Interface.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an Interface instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fbf, fbg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            """
            fbg.Interface.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that all Interface instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fbf, fbh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            """
            fbf.Interface.name description
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    // Enum
    test('that an Enum description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([fca, fcb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fcb.Enum description
        """
        enum Enum {
          """
          fca.Enum.A description dolorem ipsum
          """
          A
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Enum extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fca, fcc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fcc.Enum extension
          """
          enum Enum {
            """
            fca.Enum.A description dolorem ipsum
            """
            A
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Enum extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fca, fcd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fcd.Enum extension
          """
          enum Enum {
            """
            fca.Enum.A description dolorem ipsum
            """
            A
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Enum attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fcb, fce]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(ENUM, [fcb.name, fce.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that an Enum description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fca, fcf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fca.Enum description dolorem ipsum
          """
          enum Enum {
            """
            fca.Enum.A description dolorem ipsum
            """
            A
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an Enum instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fcf, fcg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          enum Enum {
            """
            fcg.Enum.A description dolorem ipsum
            """
            A
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that all Enum instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fcf, fch]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          enum Enum {
            """
            fcf.Enum.A description
            """
            A
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    // Input Object
    test('that an Input Object description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([fda, fdb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fdb.Input description
        """
        input Input {
          """
          fda.Input.name description dolorem ipsum
          """
          name: String!
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Input Object extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fda, fdc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fdc.Input extension
          """
          input Input {
            """
            fda.Input.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Input Object extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fda, fdd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fdd.Input extension
          """
          input Input {
            """
            fda.Input.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Input Object attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fdb, fde]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError('Input', [fdb.name, fde.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that an Input Object description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fda, fdf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fda.Input description dolorem ipsum
          """
          input Input {
            """
            fda.Input.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an Input Object instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fdf, fdg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          input Input {
            """
            fdg.Input.name description dolorem ipsum
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that all Input Object instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fdf, fdh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          input Input {
            """
            fdf.Input.name description
            """
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    // Scalar
    test('that a Scalar description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([fea, feb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Query {
          dummy: String!
        }
        
        """
        feb.Scalar description
        """
        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a Scalar extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fea, fec]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          """
          fec.Scalar extension
          """
          scalar Scalar
          
          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a Scalar extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fea, fed]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy: String!
          }

          """
          fed.Scalar extension
          """
          scalar Scalar
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Input Object attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([feb, fee]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(SCALAR, [feb.name, fee.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that a Scalar description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fea, fef]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy: String!
          }

          """
          fea.Scalar description dolorem ipsum
          """
          scalar Scalar
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a Scalar instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fef, feg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar Scalar
        `,
        ),
      );
    });

    test('that all Scalar instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fef, feh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar Scalar
        `,
        ),
      );
    });

    // Union
    test('that a Union description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([ffa, ffb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Object {
          name: String!
        }
        
        type Query {
          dummy: String!
        }
          
        """
        ffb.Union description
        """
        union Union = Object
        
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a Union extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([ffa, ffc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          """
          ffc.Union extension
          """
          union Union = Object
          

          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a Union extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([ffa, ffd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          """
          ffd.Union extension
          """
          union Union = Object

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of a Union attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([ffb, ffe]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(UNION, [ffb.name, ffe.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that a Union description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([ffa, fff]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          """
          ffa.Union description dolorem ipsum
          """
          union Union = Object
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a Union instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fff, ffg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          union Union = Object
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that all Union instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fff, ffh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Object {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          union Union = Object
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    // Renamed root type
    test('that a renamed root type Object description is propagated to the federated graph', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fga, fgb]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fgb.MyQuery
        """
        type Query {
          """
          fga.Queries.dummy description dolorem ipsum
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a renamed root type Object extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fga, fgc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        """
        fgc.MyQuery extension
        """
        type Query {
          """
          fga.Queries.dummy description dolorem ipsum
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a renamed root type Object extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fga, fgd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fgd.MyQuery extension
          """
          type Query {
            """
            fga.Queries.dummy description dolorem ipsum
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of a renamed root type Object attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fgb, fge]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError(QUERY, [fgb.name, fge.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that a renamed root type Object description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fga, fgf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          """
          fga.Queries description dolorem ipsum
          """
          type Query {
            """
            fga.Queries.dummy description dolorem ipsum
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a renamed root type Object instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fgf, fgg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            fgf.MyQuery.dummy description
            """
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that all renamed root type Object instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fgf, fgh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            fgf.MyQuery.dummy description
            """
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    // Field
    test('that a field description is propagated to the federated graph', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fha, fhb]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Query {
          """
          fhb.Query.dummy
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a field on an Object extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fha, fhc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Query {
          """
          fhc.Query.dummy
          """
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a field on an Object extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fha, fhd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            fhd.Query.dummy override
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of a field attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fhb, fhe]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError('Query.dummy', [fhb.name, fhe.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that a field description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fha, fhf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            """
            fha.Query.dummy description dolorem ipsum
            """
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a field instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fhf, fhg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that all field instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fhf, fhh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    // Field Argument
    test('that a field argument description is propagated to the federated graph', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fia, fib]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Query {
          dummy(
            """fib.Query.dummy(arg)"""
            arg: Int!
          ): String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a field argument on an Object extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fia, fic]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        type Query {
          dummy(
            """fic.Query.dummy(arg) override"""
            arg: Int!
          ): String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that a field argument on an Object extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fia, fid]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy(
              """fid.Query.dummy(arg) override"""
              arg: Int!
            ): String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of a field argument attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fib, fie]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        configureDescriptionPropagationError('Query.dummy(arg: ...)', [fib.name, fie.name]),
      );
      expect(warnings).toHaveLength(0);
    });

    test('that a field argument description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fia, fif]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy(
              """
              fia.Query.dummy(arg) description dolorem ipsum
              """
              arg: Int!
            ): String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a field argument instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fif, fig]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy(arg: Int!): String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that all field argument instances with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fif, fih]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          type Query {
            dummy(arg: Int!): String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    // Input Value
    test('that an Input Value description is propagated to the federated graph', () => {
      const { errors, federationResult } = federateSubgraphs([fja, fjb]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
        input Input {
          """
          fjb.Input.name description
          """
          name: String!
        }
        
        type Query {
          dummy: String!
        }
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Input Value extension override description is propagated to the federated graph #1', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fja, fjc]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          input Input {
            """
            fjc.Input.name override
            """
            name: String!
          }

          type Query {
            dummy: String!
          }

          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that an Input Value extension override description is propagated to the federated graph #2', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fja, fjd]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          input Input {
            """
            fjd.Input.name override
            """
            name: String!
          }

          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if multiple instances of an Input Value attempt to propagate a description', () => {
      const { errors, warnings } = federateSubgraphs([fjb, fje]);
      expect(errors).toBeDefined();
      expect(errors!).toHaveLength(1);
      expect(errors![0]).toStrictEqual(configureDescriptionPropagationError('Input.name', [fjb.name, fje.name]));
      expect(warnings).toHaveLength(0);
    });

    test('that an Input Value description with propagateToFederatedGraph: false is not propagated', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fja, fjf]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          input Input {
            """
            fja.Input.name description dolorem ipsum
            """
            name: String!
          }

          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an Input Value instance with no description and another with propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fjf, fjg]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          input Input {
            name: String!
          }

          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that all Input Object instances with no description or propagateToFederatedGraph: false results in no description', () => {
      const { errors, federationResult, warnings } = federateSubgraphs([fjf, fjh]);
      expect(errors).toBeUndefined();
      expect(warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          input Input {
            name: String!
          }

          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });
  });
});

const na: Subgraph = {
  name: 'na',
  url: '',
  definitions: parse(`
    """
    na.Query
    """
    type Query @openfed__configureDescription {
      dummy: String!
    }
    
    extend type Query @openfed__configureDescription {
      field: Int!
    }
  `),
};

const nb: Subgraph = {
  name: 'nb',
  url: '',
  definitions: parse(`
    """
    nb.Query
    """
    type Query @openfed__configureDescription(propagateToFederatedGraph: true, propagateToFederatedGraph: true) {
      dummy: String!
    }
  `),
};

const nc: Subgraph = {
  name: 'nc',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription {
      dummy: String!
    }
  `),
};

const nd: Subgraph = {
  name: 'nd',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(propagateToFederatedGraph: 1) {
      dummy: String!
    }
  `),
};

const ne: Subgraph = {
  name: 'ne',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(federatedGraphDescriptionOverride: 1) {
      dummy: String!
    }
  `),
};

const nf: Subgraph = {
  name: 'nf',
  url: '',
  definitions: parse(`
    extend type Query @openfed__configureDescription(federatedGraphDescriptionOverride: "nf.Query override") {
      dummy: String!
    }
    
    """
    nf.Query
    """
    type Query
  `),
};

const ng: Subgraph = {
  name: 'ng',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(propagateToFederatedGraph: true) {
      dummy: String!
    }
  `),
};

const nh: Subgraph = {
  name: 'nh',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(propagateToFederatedGraph: false) {
      dummy: String!
    }
  `),
};

const faa: Subgraph = {
  name: 'faa',
  url: '',
  definitions: parse(`
    """
    faa.Query description dolorem ipsum
    """
    type Query @shareable {
      """
      faa.Query.dummy description dolorem ipsum
      """
      dummy: String!
    }
  `),
};

const fab: Subgraph = {
  name: 'fab',
  url: '',
  definitions: parse(`
    """
    fab.Query
    """
    type Query @shareable @openfed__configureDescription {
      """
      fab.Query.dummy
      """
      dummy: String!
    }
  `),
};

const fac: Subgraph = {
  name: 'fac',
  url: '',
  definitions: parse(`
    extend type Query @shareable @openfed__configureDescription(federatedGraphDescriptionOverride: "fac.Query extension") {
      """
      fac.Query.dummy
      """
      dummy: String!
    }
  `),
};

const fad: Subgraph = {
  name: 'fad',
  url: '',
  definitions: parse(`
    """
    fad.Query description dolorem ipsum
    """
    type Query
    
    extend type Query @shareable @openfed__configureDescription(federatedGraphDescriptionOverride: "fad.Query extension") {
      """
      fad.Query.dummy
      """
      dummy: String!
    }
  `),
};

const fae: Subgraph = {
  name: 'fae',
  url: '',
  definitions: parse(`
    """
    fae.Query description
    """
    type Query @shareable @openfed__configureDescription {
      """
      fae.Query.dummy
      """
      dummy: String!
    }
  `),
};

const faf: Subgraph = {
  name: 'faf',
  url: '',
  definitions: parse(`
    """
    faf.Query description
    """
    type Query @shareable @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      faf.Query.dummy description
      """
      dummy: String!
    }
  `),
};

const fag: Subgraph = {
  name: 'fag',
  url: '',
  definitions: parse(`
    type Query @shareable{
      """
      fag.Query.dummy
      """
      dummy: String!
    }
  `),
};

const fah: Subgraph = {
  name: 'fah',
  url: '',
  definitions: parse(`
    """
    fah.Query description
    """
    type Query @shareable @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fah.Query.dummy description
      """
      dummy: String!
    }
  `),
};

const fba: Subgraph = {
  name: 'fba',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    """
    fba.Interface description dolorem ipsum
    """
    interface Interface {
      """
      fba.Interface.name description dolorem ipsum
      """
      name: String!
    }
  `),
};

const fbb: Subgraph = {
  name: 'fbb',
  url: '',
  definitions: parse(`
    """
    fbb.Interface description
    """
    interface Interface @openfed__configureDescription {
      """
      fbb.Interface.name description
      """
      name: String!
    }
  `),
};

const fbc: Subgraph = {
  name: 'fbc',
  url: '',
  definitions: parse(`
    extend interface Interface @openfed__configureDescription(federatedGraphDescriptionOverride: "fbc.Interface extension") {
      """
      fbc.Interface.name description
      """
      name: String!
    }
  `),
};

const fbd: Subgraph = {
  name: 'fbd',
  url: '',
  definitions: parse(`
    """
    fbd.Interface description dolorem ipsum
    """
    interface Interface
    
    extend interface Interface @openfed__configureDescription(federatedGraphDescriptionOverride: "fbd.Interface extension") {
      """
      fbd.Interface.name
      """
      name: String!
    }
  `),
};

const fbe: Subgraph = {
  name: 'fbe',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    """
    fbe.Interface
    """
    interface Interface @openfed__configureDescription {
      """
      fbe.Interface.name description
      """
      name: String!
    }
  `),
};

const fbf: Subgraph = {
  name: 'fbf',
  url: '',
  definitions: parse(`
    """
    fbf.Interface description dolorem ipsum quia dolor sit amet
    """
    interface Interface @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fbf.Interface.name description
      """
      name: String!
    }
  `),
};

const fbg: Subgraph = {
  name: 'fbg',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    interface Interface {
      """
      fbg.Interface.name description dolorem ipsum
      """
      name: String!
    }
  `),
};

const fbh: Subgraph = {
  name: 'fbh',
  url: '',
  definitions: parse(`
    """
    fbh.Interface description dolorem ipsum quia dolor sit amet
    """
    interface Interface @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fbh.Interface.name description
      """
      name: String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const fca: Subgraph = {
  name: 'fca',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    """
    fca.Enum description dolorem ipsum
    """
    enum Enum {
      """
      fca.Enum.A description dolorem ipsum
      """
      A
    }
  `),
};

const fcb: Subgraph = {
  name: 'fcb',
  url: '',
  definitions: parse(`
    """
    fcb.Enum description
    """
    enum Enum @openfed__configureDescription {
      """
      fcb.Enum.A description
      """
      A
    }
  `),
};

const fcc: Subgraph = {
  name: 'fcc',
  url: '',
  definitions: parse(`
    extend enum Enum @openfed__configureDescription(federatedGraphDescriptionOverride: "fcc.Enum extension") {
      """
      fcc.Enum.A description
      """
      A
    }
  `),
};

const fcd: Subgraph = {
  name: 'fcd',
  url: '',
  definitions: parse(`
    """
    fcd.Enum description dolorem ipsum
    """
    enum Enum
    
    extend enum Enum @openfed__configureDescription(federatedGraphDescriptionOverride: "fcd.Enum extension") {
      """
      fcd.Enum.A description
      """
      A
    }
  `),
};

const fce: Subgraph = {
  name: 'fce',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    """
    fce.Enum description
    """
    enum Enum @openfed__configureDescription {
      """
      fce.Enum.A description
      """
      A
    }
  `),
};

const fcf: Subgraph = {
  name: 'fcf',
  url: '',
  definitions: parse(`
    """
    fcf.Enum description dolorem ipsum quia dolor sit amet
    """
    enum Enum @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fcf.Enum.A description
      """
      A
    }
  `),
};

const fcg: Subgraph = {
  name: 'fcg',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    enum Enum {
      """
      fcg.Enum.A description dolorem ipsum
      """
      A
    }
  `),
};

const fch: Subgraph = {
  name: 'fch',
  url: '',
  definitions: parse(`
    """
    fch.Enum description dolorem ipsum quia dolor sit amet
    """
    enum Enum @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fch.Enum.A description
      """
      A
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const fda: Subgraph = {
  name: 'fda',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    """
    fda.Input description dolorem ipsum
    """
    input Input {
      """
      fda.Input.name description dolorem ipsum
      """
      name: String!
    }
  `),
};

const fdb: Subgraph = {
  name: 'fdb',
  url: '',
  definitions: parse(`
    """
    fdb.Input description
    """
    input Input @openfed__configureDescription {
      """
      fdb.Input.name description
      """
      name: String!
    }
  `),
};

const fdc: Subgraph = {
  name: 'fdc',
  url: '',
  definitions: parse(`
    extend input Input @openfed__configureDescription(federatedGraphDescriptionOverride: "fdc.Input extension") {
      """
      fdc.Input.name description
      """
      name: String!
    }
  `),
};

const fdd: Subgraph = {
  name: 'fdd',
  url: '',
  definitions: parse(`
    """
    fdd.Input description dolorem ipsum
    """
    input Input
    
    extend input Input @openfed__configureDescription(federatedGraphDescriptionOverride: "fdd.Input extension") {
      """
      fdd.Input.name
      """
      name: String!
    }
  `),
};

const fde: Subgraph = {
  name: 'fde',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    """
    fde.Input
    """
    input Input @openfed__configureDescription {
      """
      fde.Input.name description
      """
      name: String!
    }
  `),
};

const fdf: Subgraph = {
  name: 'fdf',
  url: '',
  definitions: parse(`
    """
    fdf.Input description dolorem ipsum quia dolor sit amet
    """
    input Input @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fdf.Input.name description
      """
      name: String!
    }
  `),
};

const fdg: Subgraph = {
  name: 'fdg',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    input Input {
      """
      fdg.Input.name description dolorem ipsum
      """
      name: String!
    }
  `),
};

const fdh: Subgraph = {
  name: 'fdh',
  url: '',
  definitions: parse(`
    """
    fdh.Input description dolorem ipsum quia dolor sit amet
    """
    input Input @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fdh.Input.name description
      """
      name: String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const fea: Subgraph = {
  name: 'fea',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    """
    fea.Scalar description dolorem ipsum
    """
    scalar Scalar
  `),
};

const feb: Subgraph = {
  name: 'feb',
  url: '',
  definitions: parse(`
    """
    feb.Scalar description
    """
    scalar Scalar @openfed__configureDescription
  `),
};

const fec: Subgraph = {
  name: 'fec',
  url: '',
  definitions: parse(`
    extend scalar Scalar @openfed__configureDescription(federatedGraphDescriptionOverride: "fec.Scalar extension")
    
    scalar Scalar
  `),
};

const fed: Subgraph = {
  name: 'fed',
  url: '',
  definitions: parse(`
    """
    fed.Scalar description dolorem ipsum
    """
    scalar Scalar
    
    extend scalar Scalar @openfed__configureDescription(federatedGraphDescriptionOverride: "fed.Scalar extension")
  `),
};

const fee: Subgraph = {
  name: 'fee',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    """
    fee.Scalar
    """
    scalar Scalar @openfed__configureDescription
  `),
};

const fef: Subgraph = {
  name: 'fef',
  url: '',
  definitions: parse(`
    """
    fef.Scalar description dolorem ipsum quia dolor sit amet
    """
    scalar Scalar @openfed__configureDescription(propagateToFederatedGraph: false)
  `),
};

const feg: Subgraph = {
  name: 'feg',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    scalar Scalar
  `),
};

const feh: Subgraph = {
  name: 'feh',
  url: '',
  definitions: parse(`
    """
    feh.Scalar description dolorem ipsum quia dolor sit amet
    """
    scalar Scalar @openfed__configureDescription(propagateToFederatedGraph: false)
    
    type Query {
      dummy: String!
    }
  `),
};

const ffa: Subgraph = {
  name: 'ffa',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }
    
    type Object @shareable {
      name: String!
    }

    """
    ffa.Union description dolorem ipsum
    """
    union Union = Object
  `),
};

const ffb: Subgraph = {
  name: 'ffb',
  url: '',
  definitions: parse(`
    type Object @shareable {
      name: String!
    }
    
    """
    ffb.Union description
    """
    union Union @openfed__configureDescription = Object
  `),
};

const ffc: Subgraph = {
  name: 'ffc',
  url: '',
  definitions: parse(`
    extend union Union @openfed__configureDescription(federatedGraphDescriptionOverride: "ffc.Union extension") = Object
  
    type Object @shareable {
      name: String!
    }
  `),
};

const ffd: Subgraph = {
  name: 'ffd',
  url: '',
  definitions: parse(`
    type Object @shareable {
      name: String!
    }
    
    """
    ffd.Union description dolorem ipsum
    """
    union Union
    
    extend union Union @openfed__configureDescription(federatedGraphDescriptionOverride: "ffd.Union extension") = Object
  `),
};

const ffe: Subgraph = {
  name: 'ffe',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
    
    type Object @shareable {
      name: String!
    }
    
    """
    ffe.Union
    """
    union Union @openfed__configureDescription = Object
  `),
};

const fff: Subgraph = {
  name: 'fff',
  url: '',
  definitions: parse(`
    """
    fff.Interface description dolorem ipsum quia dolor sit amet
    """
    union Union @openfed__configureDescription(propagateToFederatedGraph: false) = Object
    
    type Object @shareable {
      name: String!
    }
  `),
};

const ffg: Subgraph = {
  name: 'ffg',
  url: '',
  definitions: parse(`
    type Object @shareable {
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union = Object
  `),
};

const ffh: Subgraph = {
  name: 'ffh',
  url: '',
  definitions: parse(`
    """
    ffh.Union description dolorem ipsum quia dolor sit amet
    """
    union Union @openfed__configureDescription(propagateToFederatedGraph: false) = Object
    
    type Object @shareable {
      name: String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const fga: Subgraph = {
  name: 'fga',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    """
    fga.Queries description dolorem ipsum
    """
    type Queries @shareable {
      """
      fga.Queries.dummy description dolorem ipsum
      """
      dummy: String!
    }
  `),
};

const fgb: Subgraph = {
  name: 'fgb',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    """
    fgb.MyQuery
    """
    type MyQuery @shareable @openfed__configureDescription {
      """
      fgb.MyQuery.dummy
      """
      dummy: String!
    }
  `),
};

const fgc: Subgraph = {
  name: 'fgc',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    extend type MyQuery @shareable @openfed__configureDescription(federatedGraphDescriptionOverride: "fgc.MyQuery extension") {
      """
      fgc.Query.dummy
      """
      dummy: String!
    }
  `),
};

const fgd: Subgraph = {
  name: 'fgd',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    """
    fgd.MyQuery description dolorem ipsum
    """
    type MyQuery
    
    extend type MyQuery @shareable @openfed__configureDescription(federatedGraphDescriptionOverride: "fgd.MyQuery extension") {
      """
      fgd.MyQuery.dummy
      """
      dummy: String!
    }
  `),
};

const fge: Subgraph = {
  name: 'fge',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    """
    fge.MyQuery description
    """
    type MyQuery @shareable @openfed__configureDescription {
      """
      fge.MyQuery.dummy
      """
      dummy: String!
    }
  `),
};

const fgf: Subgraph = {
  name: 'fgf',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    """
    fgf.MyQuery description dolorem ipsum quia dolor sit amet
    """
    type MyQuery @shareable @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fgf.MyQuery.dummy description
      """
      dummy: String!
    }
  `),
};

const fgg: Subgraph = {
  name: 'fgg',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    type Queries @shareable{
      """
      fgg.Queries.dummy
      """
      dummy: String!
    }
  `),
};

const fgh: Subgraph = {
  name: 'fgh',
  url: '',
  definitions: parse(`
    schema {
      query: Queries
    }
    
    """
    fgh.Queries description
    """
    type Queries @shareable @openfed__configureDescription(propagateToFederatedGraph: false) {
      """
      fgh.Queries.dummy description
      """
      dummy: String!
    }
  `),
};

const fha: Subgraph = {
  name: 'fha',
  url: '',
  definitions: parse(`
    type Query @shareable {
      """
      fha.Query.dummy description dolorem ipsum
      """
      dummy: String!
    }
  `),
};

const fhb: Subgraph = {
  name: 'fhb',
  url: '',
  definitions: parse(`
    type Query @shareable {
      """
      fhb.Query.dummy
      """
      dummy: String! @openfed__configureDescription
    }
  `),
};

const fhc: Subgraph = {
  name: 'fhc',
  url: '',
  definitions: parse(`
    extend type Query @shareable {
      dummy: String! @openfed__configureDescription(federatedGraphDescriptionOverride: "fhc.Query.dummy")
    }
  `),
};

const fhd: Subgraph = {
  name: 'fhd',
  url: '',
  definitions: parse(`
    type Query
    
    extend type Query @shareable {
      """
      fhd.Query.dummy
      """
      dummy: String! @openfed__configureDescription(federatedGraphDescriptionOverride: "fhd.Query.dummy override")
    }
  `),
};

const fhe: Subgraph = {
  name: 'fhe',
  url: '',
  definitions: parse(`
    type Query @shareable {
      """
      fhe.Query.dummy
      """
      dummy: String! @openfed__configureDescription
    }
  `),
};

const fhf: Subgraph = {
  name: 'fhf',
  url: '',
  definitions: parse(`
    type Query @shareable {
      """
      fhf.Query.dummy description delorem ipsum quia dolor sit amet
      """
      dummy: String! @openfed__configureDescription(propagateToFederatedGraph: false)
    }
  `),
};

const fhg: Subgraph = {
  name: 'fhg',
  url: '',
  definitions: parse(`
    type Query @shareable{
      dummy: String!
    }
  `),
};

const fhh: Subgraph = {
  name: 'fhh',
  url: '',
  definitions: parse(`
    type Query @shareable  {
      """
      fhh.Query.dummy description
      """
      dummy: String! @openfed__configureDescription(propagateToFederatedGraph: false)
    }
  `),
};

const fia: Subgraph = {
  name: 'fia',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy(
        """
        fia.Query.dummy(arg) description dolorem ipsum
        """
        arg: Int!
      ): String!
    }
  `),
};

const fib: Subgraph = {
  name: 'fib',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy(
        """
        fib.Query.dummy(arg)
        """
        arg: Int! @openfed__configureDescription
      ): String!
    }
  `),
};

const fic: Subgraph = {
  name: 'fic',
  url: '',
  definitions: parse(`
    extend type Query @shareable {
      dummy(
        """
        fic.Query.dummy(arg)
        """
        arg: Int! @openfed__configureDescription(federatedGraphDescriptionOverride: "fic.Query.dummy(arg) override")
      ): String!
    }
  `),
};

const fid: Subgraph = {
  name: 'fid',
  url: '',
  definitions: parse(`
    type Query
    
    extend type Query @shareable {
      dummy(
        """
        fid.Query.dummy(arg)
        """
        arg: Int! @openfed__configureDescription(federatedGraphDescriptionOverride: "fid.Query.dummy(arg) override")
      ): String!
    }
  `),
};

const fie: Subgraph = {
  name: 'fie',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy(
        """
        fie.Query.dummy(arg)
        """
        arg: Int! @openfed__configureDescription
      ): String!
    }
  `),
};

const fif: Subgraph = {
  name: 'fif',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy(
        """
        fif.Query.dummy(arg) description dolorem ipsum quia dolor sit amet
        """
        arg: Int! @openfed__configureDescription(propagateToFederatedGraph: false)
      ): String!
    }
  `),
};

const fig: Subgraph = {
  name: 'fig',
  url: '',
  definitions: parse(`
    type Query @shareable{
      dummy(arg: Int!): String!
    }
  `),
};

const fih: Subgraph = {
  name: 'fih',
  url: '',
  definitions: parse(`
    type Query @shareable  {
      dummy(
        """
        fih.Query.dummy(arg) description
        """
        arg: Int! @openfed__configureDescription(propagateToFederatedGraph: false)
      ): String!
    }
  `),
};

const fja: Subgraph = {
  name: 'fja',
  url: '',
  definitions: parse(`
    type Query @shareable {
      dummy: String!
    }

    input Input {
      """
      fja.Input.name description dolorem ipsum
      """
      name: String!
    }
  `),
};

const fjb: Subgraph = {
  name: 'fjb',
  url: '',
  definitions: parse(`
    input Input {
      """
      fjb.Input.name description
      """
      name: String! @openfed__configureDescription
    }
  `),
};

const fjc: Subgraph = {
  name: 'fjc',
  url: '',
  definitions: parse(`
    extend input Input {
      name: String! @openfed__configureDescription(federatedGraphDescriptionOverride: "fjc.Input.name override")
    }
  `),
};

const fjd: Subgraph = {
  name: 'fjd',
  url: '',
  definitions: parse(`
    input Input

    extend input Input {
      """
      fjd.Input.name description
      """
      name: String! @openfed__configureDescription(federatedGraphDescriptionOverride: "fjd.Input.name override")
    }
  `),
};

const fje: Subgraph = {
  name: 'fje',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    input Input {
      """
      fje.Input.name description
      """
      name: String! @openfed__configureDescription
    }
  `),
};

const fjf: Subgraph = {
  name: 'fjf',
  url: '',
  definitions: parse(`
    input Input {
      """
      fjf.Input.name description
      """
      name: String! @openfed__configureDescription(propagateToFederatedGraph: false)
    }
  `),
};

const fjg: Subgraph = {
  name: 'fjg',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    input Input {
      name: String!
    }
  `),
};

const fjh: Subgraph = {
  name: 'fjh',
  url: '',
  definitions: parse(`
    input Input {
      """
      fjh.Input.name description
      """
      name: String! @openfed__configureDescription(propagateToFederatedGraph: false)
    }

    type Query {
      dummy: String!
    }
  `),
};

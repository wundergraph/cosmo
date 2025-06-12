import { describe, expect, test } from 'vitest';
import { parse } from 'graphql';
import {
  CONFIGURE_DESCRIPTION,
  configureDescriptionNoDescriptionError,
  configureDescriptionPropagationError,
  DESCRIPTION_OVERRIDE,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  ENUM,
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  FIRST_ORDINAL,
  INTERFACE,
  invalidArgumentValueErrorMessage,
  invalidDirectiveError,
  invalidRepeatedDirectiveErrorMessage,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  PROPAGATE,
  QUERY,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SCALAR,
  STRING_SCALAR,
  Subgraph,
  UNION,
} from '../../../src';
import {
  baseDirectiveDefinitionsWithConfigureDescription,
  schemaQueryDefinition,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from '../utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';

describe('@openfed__configureDescription tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if the directive is repeated', () => {
      const result = normalizeSubgraph(
        na.definitions,
        na.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidRepeatedDirectiveErrorMessage(CONFIGURE_DESCRIPTION),
        ]),
      );
    });

    test('that an error is returned if the directive arguments are repeated', () => {
      const result = normalizeSubgraph(
        nb.definitions,
        nb.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          duplicateDirectiveArgumentDefinitionsErrorMessage([PROPAGATE]),
        ]),
      );
    });

    test('that an error is returned if no description nor arguments are defined', () => {
      const result = normalizeSubgraph(
        nc.definitions,
        nc.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });

    test('that an error is returned if propagate receives a non-boolean value', () => {
      const result = normalizeSubgraph(
        nd.definitions,
        nd.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('1', `@${CONFIGURE_DESCRIPTION}`, PROPAGATE, 'Boolean!'),
        ]),
      );
    });

    test('that an error is returned if descriptionOverride receives a non-string value', () => {
      const result = normalizeSubgraph(
        ne.definitions,
        ne.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        invalidDirectiveError(CONFIGURE_DESCRIPTION, 'Query', FIRST_ORDINAL, [
          invalidArgumentValueErrorMessage('1', `@${CONFIGURE_DESCRIPTION}`, DESCRIPTION_OVERRIDE, STRING_SCALAR),
        ]),
      );
    });

    test('that an extension with a directive can occur before the description is defined', () => {
      const result = normalizeSubgraph(
        nf.definitions,
        nf.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitionsWithConfigureDescription +
            `
          """
          nf.Query
          """
          type Query @openfed__configureDescription(descriptionOverride: "nf.Query override") {
            dummy: String!
          }

          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if propagate is true and no description nor override value is defined #1', () => {
      const result = normalizeSubgraph(
        ng.definitions,
        ng.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });

    test('that an error is returned if propagate is false and no description nor override value is defined #1', () => {
      const result = normalizeSubgraph(
        nh.definitions,
        nh.name,
        undefined,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as NormalizationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionNoDescriptionError('Object', 'Query'));
    });
  });

  describe('Federation tests', () => {
    // Object
    test('that an Object description is propagated to the federated graph', () => {
      const result = federateSubgraphs([faa, fab], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([faa, fac], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([faa, fad], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fab, fae], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(QUERY, [fab.name, fae.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Object description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([faa, faf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that an Object instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([faf, fag], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Object instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([faf, fah], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fba, fbb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fba, fbc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fba, fbd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fbb, fbe], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(INTERFACE, [fbb.name, fbe.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Interface description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fba, fbf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that an Interface instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fbf, fbg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Interface instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fbf, fbh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fca, fcb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fca, fcc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fca, fcd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fcb, fce], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(ENUM, [fcb.name, fce.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Enum description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fca, fcf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that an Enum instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fcf, fcg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Enum instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fcf, fch], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fda, fdb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fda, fdc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fda, fdd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fdb, fde], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError('Input', [fdb.name, fde.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Input Object description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fda, fdf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that an Input Object instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fdf, fdg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Input Object instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fdf, fdh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fea, feb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fea, fec], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fea, fed], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([feb, fee], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(SCALAR, [feb.name, fee.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that a Scalar description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fea, fef], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a Scalar instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fef, feg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Scalar instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fef, feh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([ffa, ffb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([ffa, ffc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([ffa, ffd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([ffb, ffe], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(UNION, [ffb.name, ffe.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that a Union description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([ffa, fff], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a Union instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fff, ffg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Union instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fff, ffh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fga, fgb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fga, fgc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fga, fgd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fgb, fge], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError(QUERY, [fgb.name, fge.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that a renamed root type Object description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fga, fgf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a renamed root type Object instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fgf, fgg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all renamed root type Object instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fgf, fgh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fha, fhb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fha, fhc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fha, fhd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fhb, fhe], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError('Query.dummy', [fhb.name, fhe.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that a field description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fha, fhf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a field instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fhf, fhg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all field instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fhf, fhh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fia, fib], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fia, fic], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fia, fid], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fib, fie], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        configureDescriptionPropagationError('Query.dummy(arg: ...)', [fib.name, fie.name]),
      );
      expect(result.warnings).toHaveLength(0);
    });

    test('that a field argument description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fia, fif], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that a field argument instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fif, fig], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all field argument instances with propagate: false results in no description', () => {
      const result = federateSubgraphs([fif, fih], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fja, fjb], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fja, fjc], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fja, fjd], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      const result = federateSubgraphs([fjb, fje], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultFailure;
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(configureDescriptionPropagationError('Input.name', [fjb.name, fje.name]));
      expect(result.warnings).toHaveLength(0);
    });

    test('that an Input Value description with propagate: false is not propagated', () => {
      const result = federateSubgraphs([fja, fjf], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that an Input Value instance with no description and another with propagate: false results in no description', () => {
      const result = federateSubgraphs([fjf, fjg], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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

    test('that all Input Object instances with no description or propagate: false results in no description', () => {
      const result = federateSubgraphs([fjf, fjh], ROUTER_COMPATIBILITY_VERSION_ONE) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
    type Query @openfed__configureDescription(propagate: true, propagate: true) {
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
    type Query @openfed__configureDescription(propagate: 1) {
      dummy: String!
    }
  `),
};

const ne: Subgraph = {
  name: 'ne',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(descriptionOverride: 1) {
      dummy: String!
    }
  `),
};

const nf: Subgraph = {
  name: 'nf',
  url: '',
  definitions: parse(`
    extend type Query @openfed__configureDescription(descriptionOverride: "nf.Query override") {
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
    type Query @openfed__configureDescription(propagate: true) {
      dummy: String!
    }
  `),
};

const nh: Subgraph = {
  name: 'nh',
  url: '',
  definitions: parse(`
    type Query @openfed__configureDescription(propagate: false) {
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
    extend type Query @shareable @openfed__configureDescription(descriptionOverride: "fac.Query extension") {
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
    
    extend type Query @shareable @openfed__configureDescription(descriptionOverride: "fad.Query extension") {
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
    type Query @shareable @openfed__configureDescription(propagate: false) {
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
    type Query @shareable @openfed__configureDescription(propagate: false) {
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
    extend interface Interface @openfed__configureDescription(descriptionOverride: "fbc.Interface extension") {
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
    
    extend interface Interface @openfed__configureDescription(descriptionOverride: "fbd.Interface extension") {
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
    interface Interface @openfed__configureDescription(propagate: false) {
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
    interface Interface @openfed__configureDescription(propagate: false) {
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
    extend enum Enum @openfed__configureDescription(descriptionOverride: "fcc.Enum extension") {
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
    
    extend enum Enum @openfed__configureDescription(descriptionOverride: "fcd.Enum extension") {
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
    enum Enum @openfed__configureDescription(propagate: false) {
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
    enum Enum @openfed__configureDescription(propagate: false) {
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
    extend input Input @openfed__configureDescription(descriptionOverride: "fdc.Input extension") {
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
    
    extend input Input @openfed__configureDescription(descriptionOverride: "fdd.Input extension") {
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
    input Input @openfed__configureDescription(propagate: false) {
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
    input Input @openfed__configureDescription(propagate: false) {
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
    extend scalar Scalar @openfed__configureDescription(descriptionOverride: "fec.Scalar extension")
    
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
    
    extend scalar Scalar @openfed__configureDescription(descriptionOverride: "fed.Scalar extension")
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
    scalar Scalar @openfed__configureDescription(propagate: false)
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
    scalar Scalar @openfed__configureDescription(propagate: false)
    
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
    extend union Union @openfed__configureDescription(descriptionOverride: "ffc.Union extension") = Object
  
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
    
    extend union Union @openfed__configureDescription(descriptionOverride: "ffd.Union extension") = Object
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
    union Union @openfed__configureDescription(propagate: false) = Object
    
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
    union Union @openfed__configureDescription(propagate: false) = Object
    
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
    
    extend type MyQuery @shareable @openfed__configureDescription(descriptionOverride: "fgc.MyQuery extension") {
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
    
    extend type MyQuery @shareable @openfed__configureDescription(descriptionOverride: "fgd.MyQuery extension") {
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
    type MyQuery @shareable @openfed__configureDescription(propagate: false) {
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
    type Queries @shareable @openfed__configureDescription(propagate: false) {
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
      dummy: String! @openfed__configureDescription(descriptionOverride: "fhc.Query.dummy")
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
      dummy: String! @openfed__configureDescription(descriptionOverride: "fhd.Query.dummy override")
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
      dummy: String! @openfed__configureDescription(propagate: false)
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
      dummy: String! @openfed__configureDescription(propagate: false)
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
        arg: Int! @openfed__configureDescription(descriptionOverride: "fic.Query.dummy(arg) override")
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
        arg: Int! @openfed__configureDescription(descriptionOverride: "fid.Query.dummy(arg) override")
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
        arg: Int! @openfed__configureDescription(propagate: false)
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
        arg: Int! @openfed__configureDescription(propagate: false)
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
      name: String! @openfed__configureDescription(descriptionOverride: "fjc.Input.name override")
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
      name: String! @openfed__configureDescription(descriptionOverride: "fjd.Input.name override")
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
      name: String! @openfed__configureDescription(propagate: false)
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
      name: String! @openfed__configureDescription(propagate: false)
    }

    type Query {
      dummy: String!
    }
  `),
};

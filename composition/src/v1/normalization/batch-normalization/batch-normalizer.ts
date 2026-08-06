import type {
  AbstractTypeName,
  DirectiveName,
  FieldName,
  InterfaceTypeName,
  SubgraphName,
  TypeName,
} from '../../../types/types';
import { type AuthorizationData, type EntityData } from '../../../schema-building/types/types';
import type { InternalSubgraph, Subgraph } from '../../../subgraph/types';
import type { Warning } from '../../../warnings/types';
import type { BatchNormalizeParams } from '../types/params';
import { type CompositionOptions } from '../../../types/params';
import type { BatchNormalizationResult } from '../../../normalization/types';
import { Graph } from '../../../resolvability-graph/graph';
import {
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  duplicateSubgraphNamesError,
  nonEqualComposeDirectiveMajorVersionError,
  nonEqualCoreFeatureComposeDirectiveError,
  noSubgraphNameError,
  orScopesLimitError,
  subgraphValidationError,
  unknownSubgraphNameError,
} from '../../../errors/errors';
import { subtractSet, upsertAuthorizationData, upsertEntityData } from '../../utils/utils';
import { addIterableToSet, getOrThrowError, getValueOrDefault, mergeSetValueMap } from '../../../utils/utils';
import { upsertFederatedDirectiveData } from '../utils';
import { invalidOverrideTargetSubgraphNameWarning } from '../../warnings/warnings';
import { MAX_OR_SCOPES } from '../../constants/constants';
import { normalizeSubgraph } from '../normalization-factory';
import { type LinkImportData } from '../types/types';
import { type HandleOverridesParams } from './types/params';
import { internalSubgraphFromNormalization } from '../../../subgraph/utils';
import { type DirectiveDefinitionData } from '../../../directive-definition-data/types/types';

export class BatchNormalizer {
  authorizationDataByParentTypeName = new Map<TypeName, AuthorizationData>();
  concreteTypeNamesByAbstractTypeName = new Map<AbstractTypeName, Set<TypeName>>();
  entityDataByTypeName = new Map<TypeName, EntityData>();
  errors: Array<Error> = [];
  executableDirectiveDatasByName = new Map<DirectiveName, Array<DirectiveDefinitionData>>();
  federatedDirectiveDataByName = new Map<DirectiveName, DirectiveDefinitionData>();
  importDataByDirectiveName = new Map<DirectiveName, LinkImportData>();
  interfaceImplementationTypeNamesByInterfaceTypeName = new Map<InterfaceTypeName, Set<InterfaceTypeName>>();
  internalSubgraphBySubgraphName = new Map<SubgraphName, InternalSubgraph>();
  overriddenFieldNamesByParentTypeNameByTargetSubgraphName = new Map<SubgraphName, Map<TypeName, Set<FieldName>>>();
  overrideSourceSubgraphNamesByFieldCoords = new Map<string, Array<SubgraphName>>();
  duplicateOverriddenFieldCoords = new Set<string>();
  subgraphNames = new Set<SubgraphName>();
  invalidORScopesCoords = new Set<string>();
  fieldCoordsByNamedTypeName = new Map<TypeName, Set<string>>();
  subgraphs: Array<Subgraph>;
  warnings: Array<Warning> = [];
  validationErrors: Array<Error> = [];
  options?: CompositionOptions;

  constructor({ options, subgraphs }: BatchNormalizeParams) {
    this.options = options;
    this.subgraphs = subgraphs;
    const duplicateSubgraphNames = new Set<SubgraphName>();
    for (const { name } of subgraphs) {
      if (!name) {
        this.errors.push(noSubgraphNameError);
        break;
      }

      if (this.subgraphNames.has(name)) {
        duplicateSubgraphNames.add(name);
      } else {
        this.subgraphNames.add(name);
      }
    }

    if (duplicateSubgraphNames.size > 0) {
      this.errors.push(duplicateSubgraphNamesError([...duplicateSubgraphNames]));
    }
  }

  handleLinkImports(importDataByDirectiveName: Map<DirectiveName, LinkImportData>): void {
    for (const [directiveName, importData] of importDataByDirectiveName) {
      const existingData = this.importDataByDirectiveName.get(directiveName);
      if (!existingData) {
        this.importDataByDirectiveName.set(directiveName, importData);
        continue;
      }

      if (existingData.coreUrl !== importData.coreUrl) {
        // TODO handle duplicates
        this.errors.push(nonEqualCoreFeatureComposeDirectiveError(directiveName));
        continue;
      }

      if (existingData.majorVersion !== importData.majorVersion) {
        this.errors.push(nonEqualComposeDirectiveMajorVersionError(directiveName));
      }

      if (existingData.minorVersion < importData.minorVersion) {
        existingData.minorVersion = importData.minorVersion;
        existingData.node = importData.node;
      }
    }
  }

  handleEntityData(entityDataByTypeName: Map<TypeName, EntityData>, subgraphName: SubgraphName): void {
    for (const [typeName, entityData] of entityDataByTypeName) {
      const keyFieldSetDataByFieldSet = entityData.keyFieldSetDatasBySubgraphName.get(subgraphName);
      if (!keyFieldSetDataByFieldSet) {
        continue;
      }
      upsertEntityData({
        entityDataByTypeName: this.entityDataByTypeName,
        keyFieldSetDataByFieldSet,
        typeName,
        subgraphName,
      });
    }
  }

  handleOverrides({
    originalTypeNameByRenamedTypeName,
    overriddenFieldNamesByParentTypeNameByTargetSubgraphName,
    subgraphName,
  }: HandleOverridesParams) {
    for (const [
      targetSubgraphName,
      overriddenFieldNamesByTypeName,
    ] of overriddenFieldNamesByParentTypeNameByTargetSubgraphName) {
      const isTargetValid = this.subgraphNames.has(targetSubgraphName);
      for (const [parentTypeName, fieldNames] of overriddenFieldNamesByTypeName) {
        /* It's possible for a renamed root type to have a field overridden, so make sure any errors at this stage are
           propagated with the original typename. */
        const originalParentTypeName = originalTypeNameByRenamedTypeName.get(parentTypeName) ?? parentTypeName;
        if (!isTargetValid) {
          this.warnings.push(
            invalidOverrideTargetSubgraphNameWarning(
              targetSubgraphName,
              originalParentTypeName,
              [...fieldNames],
              subgraphName,
            ),
          );
        } else {
          const existingOverriddenFieldNamesByParentTypeName = getValueOrDefault(
            this.overriddenFieldNamesByParentTypeNameByTargetSubgraphName,
            targetSubgraphName,
            () => new Map<TypeName, Set<FieldName>>(),
          );
          const existingFieldNames = getValueOrDefault(
            existingOverriddenFieldNamesByParentTypeName,
            parentTypeName,
            () => new Set<FieldName>(fieldNames),
          );
          addIterableToSet({
            source: fieldNames,
            target: existingFieldNames,
          });
        }
        for (const fieldName of fieldNames) {
          const fieldCoords = `${originalParentTypeName}.${fieldName}`;
          const sourceSubgraphs = this.overrideSourceSubgraphNamesByFieldCoords.get(fieldCoords);
          if (!sourceSubgraphs) {
            this.overrideSourceSubgraphNamesByFieldCoords.set(fieldCoords, [subgraphName]);
            continue;
          }

          sourceSubgraphs.push(subgraphName);
          this.duplicateOverriddenFieldCoords.add(fieldCoords);
        }
      }
    }
  }

  handleOverrideConfigurationData(): void {
    for (const [targetSubgraphName, overriddenFieldNamesByParentTypeName] of this
      .overriddenFieldNamesByParentTypeNameByTargetSubgraphName) {
      const internalSubgraph = this.internalSubgraphBySubgraphName.get(targetSubgraphName);
      if (!internalSubgraph) {
        this.errors.push(unknownSubgraphNameError(targetSubgraphName));
        continue;
      }

      internalSubgraph.overriddenFieldNamesByParentTypeName = overriddenFieldNamesByParentTypeName;
      for (const [parentTypeName, fieldNames] of overriddenFieldNamesByParentTypeName) {
        const configurationData = internalSubgraph.configurationDataByTypeName.get(parentTypeName);
        if (!configurationData) {
          continue;
        }

        subtractSet(fieldNames, configurationData.fieldNames);
        if (configurationData.fieldNames.size < 1) {
          internalSubgraph.configurationDataByTypeName.delete(parentTypeName);
        }
      }
    }
  }

  batchNormalize(): BatchNormalizationResult {
    // Federation is aborted due to subgraph naming errors
    if (this.errors.length > 0) {
      return {
        errors: this.errors,
        success: false,
        warnings: this.warnings,
      };
    }

    const internalGraph = new Graph();
    for (const subgraph of this.subgraphs) {
      const subgraphName = subgraph.name;
      const normalizationResult = normalizeSubgraph({
        document: subgraph.definitions,
        internalGraph,
        options: this.options,
        subgraphName,
      });
      if (normalizationResult.warnings.length > 0) {
        this.warnings.push(...normalizationResult.warnings);
      }
      if (!normalizationResult.success) {
        this.validationErrors.push(subgraphValidationError(subgraphName, normalizationResult.errors));
        continue;
      }

      this.handleLinkImports(normalizationResult.importDataByDirectiveName);

      for (const authorizationData of normalizationResult.authorizationDataByParentTypeName.values()) {
        upsertAuthorizationData(this.authorizationDataByParentTypeName, authorizationData, this.invalidORScopesCoords);
      }
      for (const [namedTypeName, fieldCoords] of normalizationResult.fieldCoordsByNamedTypeName) {
        addIterableToSet({
          source: fieldCoords,
          target: getValueOrDefault(this.fieldCoordsByNamedTypeName, namedTypeName, () => new Set<string>()),
        });
      }
      mergeSetValueMap({
        source: normalizationResult.concreteTypeNamesByAbstractTypeName,
        target: this.concreteTypeNamesByAbstractTypeName,
      });
      mergeSetValueMap({
        source: normalizationResult.interfaceImplementationTypeNamesByInterfaceTypeName,
        target: this.interfaceImplementationTypeNamesByInterfaceTypeName,
      });
      this.handleEntityData(normalizationResult.entityDataByTypeName, subgraphName);
      upsertFederatedDirectiveData({
        executableDirectiveDatasByName: this.executableDirectiveDatasByName,
        existingDataByName: this.federatedDirectiveDataByName,
        incomingDataByName: normalizationResult.federatedDirectiveDataByName,
      });
      this.internalSubgraphBySubgraphName.set(
        subgraphName,
        internalSubgraphFromNormalization({ normalization: normalizationResult, subgraphName }),
      );
      this.handleOverrides({
        originalTypeNameByRenamedTypeName: normalizationResult.originalTypeNameByRenamedTypeName,
        overriddenFieldNamesByParentTypeNameByTargetSubgraphName:
          normalizationResult.overriddenFieldNamesByParentTypeNameByTargetSubgraphName,
        subgraphName,
      });
    }
    if (this.invalidORScopesCoords.size > 0) {
      this.errors.push(orScopesLimitError(MAX_OR_SCOPES, [...this.invalidORScopesCoords]));
    }
    if (this.duplicateOverriddenFieldCoords.size > 0) {
      const duplicateOverriddenFieldErrorMessages: string[] = [];
      for (const fieldCoords of this.duplicateOverriddenFieldCoords) {
        const sourceSubgraphNames = getOrThrowError(
          this.overrideSourceSubgraphNamesByFieldCoords,
          fieldCoords,
          'overrideSourceSubgraphNamesByFieldCoords',
        );
        duplicateOverriddenFieldErrorMessages.push(
          duplicateOverriddenFieldErrorMessage(fieldCoords, sourceSubgraphNames),
        );
      }
      this.errors.push(duplicateOverriddenFieldsError(duplicateOverriddenFieldErrorMessages));
    }

    for (const [directiveName, executableDirectiveDatas] of this.executableDirectiveDatasByName) {
      if (
        this.federatedDirectiveDataByName.has(directiveName) ||
        executableDirectiveDatas.length !== this.subgraphNames.size
      ) {
        this.executableDirectiveDatasByName.delete(directiveName);
      }
    }

    this.errors.push(...this.validationErrors);

    if (this.errors.length > 0) {
      return {
        errors: this.errors,
        success: false,
        warnings: this.warnings,
      };
    }

    this.handleOverrideConfigurationData();

    if (this.errors.length > 0) {
      return {
        errors: this.errors,
        success: false,
        warnings: this.warnings,
      };
    }

    return {
      authorizationDataByParentTypeName: this.authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName: this.concreteTypeNamesByAbstractTypeName,
      entityDataByTypeName: this.entityDataByTypeName,
      executableDirectiveDatasByName: this.executableDirectiveDatasByName,
      federatedDirectiveDataByName: this.federatedDirectiveDataByName,
      fieldCoordsByNamedTypeName: this.fieldCoordsByNamedTypeName,
      interfaceImplementationTypeNamesByInterfaceTypeName: this.interfaceImplementationTypeNamesByInterfaceTypeName,
      internalSubgraphByName: this.internalSubgraphBySubgraphName,
      internalGraph,
      success: true,
      warnings: this.warnings,
    };
  }
}

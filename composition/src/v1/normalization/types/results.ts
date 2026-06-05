import { type DirectiveName } from '../../../types/types';
import { type ExecutionMultiFailure, type ExecutionSingleFailure, type ExecutionSuccess } from '../../../types/results';
import { type SchemaDefinitionNode, type SchemaExtensionNode } from 'graphql';
import { type LinkImportData } from './types';

export interface ExtractLinkArgsSuccess extends ExecutionSuccess {
  importDataByDirectiveName: Map<DirectiveName, LinkImportData>;
}

export type ExtractLinkArgsResult = ExecutionMultiFailure | ExtractLinkArgsSuccess;

export interface ExtractImportUrlVersionSuccess extends ExecutionSuccess {
  coreUrl: string;
  majorVersion: number;
  minorVersion: number;
}

export type ExtractImportUrlSegmentsResult = ExecutionSingleFailure | ExtractImportUrlVersionSuccess;

export interface SchemaNodeSuccess extends ExecutionSuccess {
  node?: SchemaDefinitionNode | SchemaExtensionNode;
}

export type SchemaNodeResult = ExecutionMultiFailure | SchemaNodeSuccess;

export interface ExtractLinkImportsSuccess extends ExecutionSuccess {
  imports: Array<LinkImportData>;
}

export type ExtractLinkImportsResult = ExecutionMultiFailure | ExtractLinkImportsSuccess;

export interface ExtractLinkImportObjectSuccess extends ExecutionSuccess {
  import: LinkImportData;
}

export type ExtractLinkImportObjectResult = ExecutionMultiFailure | ExtractLinkImportObjectSuccess;

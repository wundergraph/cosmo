import { type TypeNode } from 'graphql';
import { type InterfaceTypeName, type TypeName } from '../types/types';

export type IsTypeValidImplementationParams = {
  concreteTypeNamesByAbstractTypeName: Map<TypeName, Set<TypeName>>;
  implementationType: TypeNode;
  interfaceImplementationTypeNamesByInterfaceTypeName: Map<InterfaceTypeName, Set<InterfaceTypeName>>;
  originalType: TypeNode;
};

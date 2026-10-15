import { AuthContext } from '../../../types/index.js';
import { CollectionRow, GraphTarget } from '../../repositories/GraphCollectionsRepository.js';

/**
 * Whether `userId` may mutate `collection`. A private one is the caller's own
 * scratchpad, so it needs only graph read access plus being its owner. A team
 * one (private_to_user_id IS NULL) is shared, so mutating it needs graph write.
 *
 * Callers must have already established graph read access.
 */
export function canMutateCollection(input: {
  collection: Pick<CollectionRow, 'privateToUserId'>;
  userId: string;
  hasGraphWriteAccess: boolean;
  organizationDeactivated: boolean;
}): boolean {
  if (input.organizationDeactivated) {
    return false;
  }

  if (input.collection.privateToUserId === null) {
    return input.hasGraphWriteAccess;
  }

  return input.collection.privateToUserId === input.userId;
}

export type CollectionAccess = { ok: true; canEdit: boolean } | { ok: false; error: string };

export function resolveCollectionAccess(
  collectionWithGraph: { collection: Pick<CollectionRow, 'privateToUserId'>; federatedGraph: GraphTarget } | undefined,
  authContext: AuthContext,
  subject: 'Collection' | 'Operation',
): CollectionAccess {
  const notFound = { ok: false, error: `${subject} not found` } as const;

  if (!collectionWithGraph) {
    return notFound;
  }

  if (!authContext.rbac.hasFederatedGraphReadAccess(collectionWithGraph.federatedGraph)) {
    return notFound;
  }

  return {
    ok: true,
    canEdit: canMutateCollection({
      collection: collectionWithGraph.collection,
      userId: authContext.userId,
      hasGraphWriteAccess: authContext.rbac.hasFederatedGraphWriteAccess(collectionWithGraph.federatedGraph),
      organizationDeactivated: authContext.organizationDeactivated,
    }),
  };
}

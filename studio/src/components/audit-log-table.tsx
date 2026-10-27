import { docsBaseURL } from '@/lib/constants';
import { AuditLog } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EmptyState } from './empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrapper } from './ui/table';
import { formatDateTime } from '@/lib/format-date';
import { capitalize } from '@/lib/utils';
import { pascalCase } from 'change-case';
import { AiOutlineAudit } from 'react-icons/ai';
import { PiKeyBold, PiRobotFill, PiUserBold } from 'react-icons/pi';
import { Badge } from './ui/badge';

export const Empty = (params: { unauthorized: boolean }) => {
  if (params.unauthorized) {
    return <EmptyState title="Unauthorized" description="You are not authorized to manage this organization." />;
  }

  return (
    <EmptyState
      icon={<AiOutlineAudit />}
      title="No audit logs"
      description={
        <div className="space-x-1">
          <span>You can view activity within your organization here.</span>
          <a target="_blank" rel="noreferrer" href={docsBaseURL + '/studio/audit-log'} className="text-primary">
            Learn more.
          </a>
        </div>
      }
    />
  );
};

export const AuditLogTable = ({ logs }: { logs?: AuditLog[] }) => {
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Actor</TableHead>
            <TableHead className="px-4">Action</TableHead>
            <TableHead className="px-4">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs?.map(
            ({
              id,
              actorDisplayName,
              apiKeyName,
              actorType,
              auditAction,
              createdAt,
              action,
              auditableDisplayName,
              targetDisplayName,
              targetType,
              targetNamespaceDisplayName,
            }) => {
              let preParagraph = null;
              let postParagraph = null;

              if (
                auditAction === 'organization_invitation.created' ||
                auditAction === 'scim.organization_invitation_created' ||
                action === 'queued_deletion'
              ) {
                postParagraph = 'for';
              } else if (auditAction === 'member_role.updated') {
                preParagraph = 'role for';
                postParagraph = 'to';
              } else if (auditAction === 'member_group.updated' || auditAction === 'api_key.group_updated') {
                preParagraph = 'group for';
                postParagraph = 'to';
              } else if (auditAction === 'member_group.added') {
                postParagraph = 'to group';
              } else if (auditAction === 'member_group.removed') {
                postParagraph = 'from group';
              } else if (auditAction === 'group.members_moved') {
                preParagraph = 'members from group';
                postParagraph = 'to ';
              } else if (action === 'moved') {
                postParagraph = `to ${targetNamespaceDisplayName} namespace,`;
              } else if (auditableDisplayName) {
                preParagraph = 'in';
                if (!!targetNamespaceDisplayName) {
                  postParagraph = `in ${targetNamespaceDisplayName} namespace,`;
                }
              }

              let label = null;
              if (targetDisplayName) {
                label = (
                  <>
                    {preParagraph && <span className="text-gray-500 dark:text-gray-400">{preParagraph}</span>}

                    <span className="inline-block max-w-md truncate" title={pascalCase(targetType)}>
                      <span className="text-purple whitespace-nowrap font-mono">{targetDisplayName}</span>
                    </span>
                  </>
                );
              }

              // Collections name the thing acted on before its graph, which the
              // generic target-then-auditable order below cannot express.
              const muted = 'text-gray-500 dark:text-gray-400';
              const subjectName = (
                <span className="inline-block max-w-md truncate text-primary">{auditableDisplayName}</span>
              );
              const inTarget = (noun: string) =>
                targetDisplayName && (
                  <>
                    <span className={muted}>in the {noun}</span>
                    <span className="text-purple whitespace-nowrap font-mono">{targetDisplayName}</span>
                  </>
                );
              const inNamespace = targetNamespaceDisplayName && (
                <span className={muted}>of the {targetNamespaceDisplayName} namespace</span>
              );
              const lead = (subject: string) => (
                <span className={muted}>
                  {capitalize(action.replaceAll('_', ' '))} {subject}
                </span>
              );

              const collectionView = (() => {
                switch (auditAction) {
                  case 'graph_collection.created':
                  case 'graph_collection.deleted': {
                    return (
                      <>
                        {lead('collection')}
                        {subjectName}
                        {inTarget('graph')}
                        {inNamespace}
                      </>
                    );
                  }
                  case 'graph_collection.shared': {
                    return (
                      <>
                        {lead('collection')}
                        {subjectName}
                        {inTarget('graph')}
                        {inNamespace}
                        <span className={muted}>with the team</span>
                      </>
                    );
                  }
                  case 'graph_collection_operation.created':
                  case 'graph_collection_operation.updated':
                  case 'graph_collection_operation.deleted': {
                    return (
                      <>
                        {lead('operation')}
                        {subjectName}
                        {inTarget('collection')}
                        {inNamespace}
                      </>
                    );
                  }
                  // A rename records only the new name, so it has to read "... to <name>".
                  case 'graph_collection.renamed':
                  case 'graph_collection_operation.renamed': {
                    return (
                      <>
                        {lead(auditAction === 'graph_collection.renamed' ? 'collection' : 'operation')}
                        {inTarget(auditAction === 'graph_collection.renamed' ? 'graph' : 'collection')}
                        {inNamespace}
                        <span className={muted}>to</span>
                        {subjectName}
                      </>
                    );
                  }
                  default: {
                    return null;
                  }
                }
              })();

              const actionView = collectionView ?? (
                <>
                  <span className="text-gray-500 dark:text-gray-400">{capitalize(action.replaceAll('_', ' '))}</span>
                  {label}
                  {auditableDisplayName && (
                    <>
                      {postParagraph && <span className="text-gray-500 dark:text-gray-400">{postParagraph}</span>}
                      <span className="inline-block max-w-md truncate text-primary">{auditableDisplayName}</span>
                    </>
                  )}
                </>
              );
              return (
                <TableRow key={id} className="group py-1">
                  <TableCell className="align-top font-medium">
                    <span className="flex items-center space-x-2">
                      {actorType === 'api_key' && <PiKeyBold className="h-4 w-4" title="API Key activity" />}
                      {actorType === 'user' && <PiUserBold className="h-4 w-4" title="User activity" />}
                      {actorType === 'system' && <PiRobotFill className="h-4 w-4" title="System activity" />}
                      <span className="block font-medium">
                        {apiKeyName ? `${apiKeyName} (${actorDisplayName})` : `${actorDisplayName}`}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div className="flex flex-wrap space-x-1.5">{actionView}</div>
                      <Badge className="font-mono" variant="outline">
                        {auditAction}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{formatDateTime(new Date(createdAt))}</TableCell>
                </TableRow>
              );
            },
          )}
        </TableBody>
      </Table>
    </TableWrapper>
  );
};

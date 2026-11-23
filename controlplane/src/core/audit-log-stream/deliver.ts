import type { AuditLogStreamConfig } from '../repositories/AuditLogStreamRepository.js';
import type { AuditLogStreamDestination } from './destination.js';
import { AuditLogRow, sendToHec, toHecEvent } from './splunk-hec.js';

type FailureReason = string;

export function sendAuditLogs(config: AuditLogStreamConfig, logs: AuditLogRow[]): Promise<FailureReason | undefined> {
  const { organizationId, secret, kind, settings } = config;
  switch (kind) {
    case 'splunk_hec': {
      const target = { organizationId, token: secret, ...settings };
      return sendToHec(
        target,
        logs.map((log) => toHecEvent(log, target)),
      );
    }
    default: {
      return unhandledKind(kind);
    }
  }
}

export function destinationDisplayName(destination: AuditLogStreamDestination): string {
  switch (destination.kind) {
    case 'splunk_hec': {
      return destination.settings.endpoint;
    }
    default: {
      return unhandledKind(destination.kind);
    }
  }
}

function unhandledKind(kind: never): never {
  throw new Error(`Unknown audit log stream destination kind: ${String(kind)}`);
}

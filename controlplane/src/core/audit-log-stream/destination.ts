import { z } from 'zod';

export const splunkHecSettingsSchema = z.object({
  endpoint: z.string(),
  index: z.string().nullable(),
  source: z.string(),
  sourcetype: z.string(),
});

export const auditLogStreamDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('splunk_hec'), settings: splunkHecSettingsSchema }),
]);

export type SplunkHecSettings = z.infer<typeof splunkHecSettingsSchema>;
export type AuditLogStreamDestination = z.infer<typeof auditLogStreamDestinationSchema>;
export type AuditLogStreamKind = AuditLogStreamDestination['kind'];

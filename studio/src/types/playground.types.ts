import { z } from 'zod';

export const PlaygroundStateSchema = z.object({
    operation: z.string().min(1, 'Operation is required in playground url state'),
    variables: z.string().optional(),
    headers: z.string().optional(),
    preFlight: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
        type: z.string().optional(),
    }).optional(),
    preOperation: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
    }).optional(),
    postOperation: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
    }).optional(),
});
  
export type PlaygroundUrlState = z.infer<typeof PlaygroundStateSchema>;
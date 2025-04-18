import { z } from 'zod';

export const PlaygroundStateSchema = z.object({
    operation: z.string().min(1, 'Operation is required in playground url state'),
    variables: z.string().optional(),
    headers: z.string().optional(),
    preFlight: z.object({
        content: z.string(),
        enabled: z.boolean()
    }).optional(),
    preOperation: z.object({
        content: z.string(),
        enabled: z.boolean()
    }).optional(),
    postOperation: z.object({
        content: z.string(),
        enabled: z.boolean()
    }).optional(),
});
  
export type PlaygroundUrlState = z.infer<typeof PlaygroundStateSchema>;
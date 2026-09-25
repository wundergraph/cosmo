import { useParams } from 'next/navigation';

/** The `[slug]` and `[checkId]` route segments every page under a check is addressed by. */
export const useCheckParams = () => useParams<{ slug: string; checkId: string }>();

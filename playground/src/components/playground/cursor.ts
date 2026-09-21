export type PartitionOffset = { offset: number; epoch: number };
export type CursorPosition = Record<string, Record<string, PartitionOffset>>; // topic -> partition
export type DecodedCursor = {
  providerType: string;
  providerId: string;
  issuedAt: number;
  position: CursorPosition;
};

export const decodeCursor = (cursor: string): DecodedCursor | null => {
  try {
    let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const json = atob(base64);
    const decoded = JSON.parse(json);
    if (!decoded || typeof decoded !== 'object' || !decoded.position) {
      return null;
    }
    return decoded as DecodedCursor;
  } catch {
    return null;
  }
};

export type PositionAdvance = {
  topic: string;
  partition: string;
  offset: number;
  epoch: number;
  delta: number | null; // offset - previous offset for that partition; null on first sighting
  skipped: number; // max(0, delta - 1); 0 when contiguous or unknown
};

export const diffPositions = (prev: CursorPosition | null, next: CursorPosition): PositionAdvance[] => {
  const advances: PositionAdvance[] = [];

  for (const topic of Object.keys(next)) {
    const partitions = next[topic];
    for (const partition of Object.keys(partitions)) {
      const { offset, epoch } = partitions[partition];
      const prevOffset = prev?.[topic]?.[partition]?.offset;

      const delta = prevOffset === undefined ? null : offset - prevOffset;
      const skipped = delta === null ? 0 : Math.max(0, delta - 1);

      advances.push({ topic, partition, offset, epoch, delta, skipped });
    }
  }

  return advances;
};

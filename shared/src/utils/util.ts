export function delay(t: number) {
  return new Promise((resolve) => setTimeout(resolve, t));
}

const labelSeparator = '=';

export function splitLabel(label: string) {
  const [key, value] = label.split(labelSeparator);
  return {
    key,
    value,
  };
}

export function joinLabel({ key, value }: { key: string; value: string }) {
  return key + labelSeparator + value;
}

export const toError = (value: unknown): Error => {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'Unknown error');
};

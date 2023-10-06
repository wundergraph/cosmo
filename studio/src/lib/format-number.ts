export const formatNumber = (
  value: number,
  options?: Intl.NumberFormatOptions
) => {
  return Intl.NumberFormat(undefined, options).format(value).toString();
};

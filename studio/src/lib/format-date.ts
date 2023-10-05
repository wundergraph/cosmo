export const formatDate = (
  value: number | Date,
  options?: Intl.DateTimeFormatOptions
) => {
  return Intl.DateTimeFormat(undefined, options).format(value);
};

export const formatDateTime = (
  value: number | Date,
  options?: Intl.DateTimeFormatOptions
) => {
  return formatDate(value, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  });
};

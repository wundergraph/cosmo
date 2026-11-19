export const ok = (data) => ({ success: true, data });
export const failure = (message, cause) => ({
    success: false,
    errors: [new Error(message, cause ? { cause } : undefined)],
});
export const errorMessage = (result) => result.errors.map((error) => error.message).join('; ');
//# sourceMappingURL=result.js.map
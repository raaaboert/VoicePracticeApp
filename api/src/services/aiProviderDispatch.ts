// Evidence is process-local object identity, never an HTTP status, message,
// client field or persisted/replayed provider response. Wrap ONLY local work
// that completes before fetch is invoked; fetch rejection is always ambiguous.
const notDispatched = new WeakSet<object>();
export function prepareAiProviderRequest<T>(prepare: () => T): T {
  try { return prepare(); }
  catch (error) {
    if (error !== null && typeof error === "object") notDispatched.add(error);
    throw error;
  }
}
export function isOpenAiRequestNotDispatched(error: unknown): boolean {
  return error !== null && typeof error === "object" && notDispatched.has(error);
}

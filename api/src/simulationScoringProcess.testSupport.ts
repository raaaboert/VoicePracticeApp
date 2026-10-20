// Forked only by disposable LOCAL PostgreSQL HTTP integration tests.
const database = new URL(process.env.DATABASE_URL ?? "");
const provider = new URL(process.env.LOCAL_SCORING_PROVIDER_URL ?? "");
if (!process.send || process.env.NODE_ENV !== "test"
  || !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/test|integration/i.test(database.pathname)
  || provider.hostname !== "127.0.0.1") throw Error("Local scoring test process only");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const mocked = url.startsWith("https://api.openai.com/");
  const response = await originalFetch(mocked ? provider.href : input, init);
  if (mocked && response.headers.get("X-Local-Test-Timeout") === "1") {
    await response.arrayBuffer();
    throw new DOMException("Mocked provider timeout", "AbortError");
  }
  return response;
};
const { app } = await import("./index.js");
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") process.send?.({ port: address.port });
});
process.on("message", (message) => {
  if (message === "stop") server.close(() => process.exit(0));
});

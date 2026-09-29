import "dotenv/config";

// Deterministic, non-secret keys for tests only.
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.PHONE_HASH_KEY ??= "test-phone-hash-key-0123456789";

// Integration tests TRUNCATE tables, so they must never touch the development database:
// use TEST_DATABASE_URL, or the dev URL with "_test" appended to the database name.
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? "postgres://dor:dor@localhost:5432/dor");
  if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
  return url.toString();
}
process.env.DATABASE_URL = testDatabaseUrl();
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) {
  throw new Error("Refusing to run tests: the test database name must end with _test");
}

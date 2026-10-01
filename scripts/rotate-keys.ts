/**
 * Rotates APP_ENCRYPTION_KEY and/or PHONE_HASH_KEY (see src/server/security/rotate-keys.ts and the SECURITY section of
 * the README). Stop the application first, back up the database, then:
 *
 *   OLD_APP_ENCRYPTION_KEY=... NEW_APP_ENCRYPTION_KEY=$(openssl rand -base64 32) npx tsx scripts/rotate-keys.ts encryption
 *   OLD_PHONE_HASH_KEY=...     NEW_PHONE_HASH_KEY=$(openssl rand -hex 24)        npx tsx scripts/rotate-keys.ts phone
 *
 * and put the new values in .env before starting the application again. DATABASE_URL comes from the environment/.env.
 */
import "dotenv/config";
import { pool } from "../src/db/client";
import { rotateEncryptionKey, rotatePhoneHashKey } from "../src/server/security/rotate-keys";

async function main() {
  const what = process.argv[2];
  const need = (name: string) => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is required`);
    return v;
  };
  if (what === "encryption") {
    const r = await rotateEncryptionKey(need("OLD_APP_ENCRYPTION_KEY"), need("NEW_APP_ENCRYPTION_KEY"));
    console.log(`Re-encrypted the 2FA secrets of ${r.users} user(s). Now set APP_ENCRYPTION_KEY to the new value.`);
  } else if (what === "phone") {
    const r = await rotatePhoneHashKey(need("OLD_PHONE_HASH_KEY"), need("NEW_PHONE_HASH_KEY"));
    console.log(
      `Rehashed ${r.rehashed} visitor phone number(s); ${r.unmatched} did not match the old key and were left alone. Now set PHONE_HASH_KEY to the new value.`,
    );
  } else {
    throw new Error("usage: rotate-keys.ts encryption|phone");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool().end());

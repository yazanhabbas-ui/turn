import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users, visitors } from "@/db/schema";
import { decryptWithKey, encryptWithKey, hashPhoneWithKey, parseEncryptionKey } from "../crypto";

/**
 * Key rotation. The two secrets protect different things, so they rotate separately:
 *  - APP_ENCRYPTION_KEY encrypts the 2FA secrets (users.totp_secret_enc): they are decrypted with the old key and
 *    encrypted again with the new one, in one transaction. Nothing else is encrypted at rest.
 *  - PHONE_HASH_KEY keys the visitor phone hash (sticky routing, data-subject lookup, STOP links). Hashes are
 *    recomputed from the phone numbers that are still stored. Visitors whose number was already erased keep their old
 *    (now unmatchable) hash, which is what erasure intends. STOP links already sent in messages stop working.
 * Run with the application stopped, then switch the environment variables to the new values and start it again.
 */
export async function rotateEncryptionKey(oldKeyBase64: string, newKeyBase64: string): Promise<{ users: number }> {
  const oldKey = parseEncryptionKey(oldKeyBase64);
  const newKey = parseEncryptionKey(newKeyBase64);
  return db().transaction(async (tx) => {
    const rows = await tx.select({ id: users.id, enc: users.totpSecretEnc }).from(users).where(isNotNull(users.totpSecretEnc));
    for (const r of rows) {
      // A wrong old key fails here (GCM authentication) before anything is written: the transaction rolls back.
      const secret = decryptWithKey(oldKey, r.enc!);
      await tx
        .update(users)
        .set({ totpSecretEnc: encryptWithKey(newKey, secret) })
        .where(eq(users.id, r.id));
    }
    return { users: rows.length };
  });
}

export async function rotatePhoneHashKey(oldKey: string, newKey: string): Promise<{ rehashed: number; unmatched: number }> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .select({ id: visitors.id, phone: visitors.phone, hash: visitors.phoneHash })
      .from(visitors)
      .where(isNotNull(visitors.phone));
    let rehashed = 0;
    let unmatched = 0;
    for (const r of rows) {
      // Only rows that really were hashed with the old key are changed; anything else is reported, not guessed.
      if (r.hash !== hashPhoneWithKey(oldKey, r.phone!)) {
        unmatched++;
        continue;
      }
      await tx
        .update(visitors)
        .set({ phoneHash: hashPhoneWithKey(newKey, r.phone!) })
        .where(eq(visitors.id, r.id));
      rehashed++;
    }
    return { rehashed, unmatched };
  });
}

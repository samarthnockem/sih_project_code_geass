import type { Schema } from "mongoose";

export const forbiddenSensitiveFields = [
  "privateKey",
  "walletPrivateKey",
  "documentEncryptionPrivateKey",
  "privateEncryptionKey",
  "aesKey",
  "rawAESKey",
  "rawAesKey",
  "raw_aes_key",
  "rawKey",
  "secretKey",
  "passwordDerivedSecretKey",
  "password",
  "plaintextPassword",
  "plaintextFilePassword",
  "filePassword",
  "passphrase",
  "mnemonic",
  "seedPhrase",
  "aadhaarNumber",
  "panNumber",
  "passportNumber",
  "drivingLicenceNumber",
  "drivingLicenseNumber",
  "identityDocumentNumber",
  "identityDocumentContents"
] as const;

export function assertNoForbiddenFields(schema: Schema, modelName: string) {
  for (const field of forbiddenSensitiveFields) {
    if (schema.path(field)) {
      throw new Error(`${modelName} schema must not define forbidden field: ${field}`);
    }
  }
}

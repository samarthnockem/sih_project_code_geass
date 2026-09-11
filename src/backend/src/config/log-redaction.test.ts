import pino from "pino";
import { describe, expect, it } from "vitest";
import { logRedaction } from "./log-redaction.js";

function writeLog(payload: Record<string, unknown>) {
  let output = "";
  const stream = {
    write(chunk: string) {
      output += chunk;
    }
  };
  const testLogger = pino({ redact: logRedaction }, stream);

  testLogger.info(payload, "redaction test");

  return output;
}

describe("log redaction", () => {
  it("redacts authorization headers and cookies", () => {
    const output = writeLog({
      req: {
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=secret-session"
        }
      }
    });

    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("secret-session");
    expect(output).not.toContain("authorization");
    expect(output).not.toContain("cookie");
  });

  it("redacts private keys, AES keys, wrapped keys, passwords, and seed phrases", () => {
    const output = writeLog({
      privateKey: "private-key-value",
      private_key: "private-key-snake-value",
      walletPrivateKey: "wallet-private-key-value",
      wallet_private_key: "wallet-private-key-snake-value",
      documentEncryptionPrivateKey: "document-private-key-value",
      document_encryption_private_key: "document-private-key-snake-value",
      privateEncryptionKey: "private-encryption-key-value",
      private_encryption_key: "private-encryption-key-snake-value",
      aesKey: "raw-aes-key-value",
      rawAESKey: "raw-aes-key-alias-value",
      raw_aes_key: "raw-aes-key-snake-value",
      rawKey: "raw-key-value",
      raw_key: "raw-key-snake-value",
      secretKey: "secret-key-value",
      secret_key: "secret-key-snake-value",
      wrappedAESKey: "wrapped-key-value",
      wrapped_aes_key: "wrapped-key-snake-value",
      password: "password-value",
      plaintextPassword: "plaintext-password-value",
      passwordDerivedSecretKey: "password-derived-secret-value",
      password_derived_secret_key: "password-derived-secret-snake-value",
      passphrase: "passphrase-value",
      mnemonic: "mnemonic-value",
      seedPhrase: "seed-phrase-value",
      seed_phrase: "seed-phrase-snake-value"
    });

    expect(output).not.toContain("private-key-value");
    expect(output).not.toContain("private-key-snake-value");
    expect(output).not.toContain("wallet-private-key-value");
    expect(output).not.toContain("wallet-private-key-snake-value");
    expect(output).not.toContain("document-private-key-value");
    expect(output).not.toContain("document-private-key-snake-value");
    expect(output).not.toContain("private-encryption-key-value");
    expect(output).not.toContain("private-encryption-key-snake-value");
    expect(output).not.toContain("raw-aes-key-value");
    expect(output).not.toContain("raw-aes-key-alias-value");
    expect(output).not.toContain("raw-aes-key-snake-value");
    expect(output).not.toContain("raw-key-value");
    expect(output).not.toContain("raw-key-snake-value");
    expect(output).not.toContain("secret-key-value");
    expect(output).not.toContain("secret-key-snake-value");
    expect(output).not.toContain("wrapped-key-value");
    expect(output).not.toContain("wrapped-key-snake-value");
    expect(output).not.toContain("password-value");
    expect(output).not.toContain("plaintext-password-value");
    expect(output).not.toContain("password-derived-secret-value");
    expect(output).not.toContain("password-derived-secret-snake-value");
    expect(output).not.toContain("passphrase-value");
    expect(output).not.toContain("mnemonic-value");
    expect(output).not.toContain("seed-phrase-value");
    expect(output).not.toContain("seed-phrase-snake-value");
  });

  it("redacts full encrypted files and MongoDB credentials", () => {
    const output = writeLog({
      encryptedFile: "full-encrypted-file-contents",
      connectionString: "mongodb://user:secret-password@localhost:27017/secure-vault"
    });

    expect(output).not.toContain("full-encrypted-file-contents");
    expect(output).not.toContain("secret-password");
  });

  it("redacts identity document numbers and contents", () => {
    const output = writeLog({
      aadhaarNumber: "123412341234",
      panNumber: "ABCDE1234F",
      passportNumber: "P1234567",
      drivingLicenceNumber: "DL123456789",
      identityDocumentNumber: "IDENTITY-NUMBER",
      identityDocumentContents: "base64-identity-document"
    });

    expect(output).not.toContain("123412341234");
    expect(output).not.toContain("ABCDE1234F");
    expect(output).not.toContain("P1234567");
    expect(output).not.toContain("DL123456789");
    expect(output).not.toContain("IDENTITY-NUMBER");
    expect(output).not.toContain("base64-identity-document");
  });
});

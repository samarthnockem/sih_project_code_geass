import { describe, expect, it } from "vitest";
import { resolveMongoDatabaseName } from "./database.js";

describe("resolveMongoDatabaseName", () => {
  it("uses explicitly configured runtime database name", () => {
    expect(
      resolveMongoDatabaseName("mongodb+srv://user:pass@example.mongodb.net/?appName=Cluster0", "secure-vault", "development")
    ).toBe("secure-vault");
  });

  it("uses database name from URI when present", () => {
    expect(
      resolveMongoDatabaseName(
        "mongodb+srv://user:pass@example.mongodb.net/secure-vault?retryWrites=true&w=majority",
        undefined,
        "development"
      )
    ).toBe("secure-vault");
  });

  it("does not fall back to MongoDB default test database in runtime", () => {
    expect(
      resolveMongoDatabaseName("mongodb+srv://user:pass@example.mongodb.net/?appName=Cluster0", undefined, "development")
    ).toBe("secure-vault");
  });

  it("keeps tests isolated when no database name is present", () => {
    expect(resolveMongoDatabaseName("mongodb://127.0.0.1:27017", undefined, "test")).toBe("secure-vault-test");
  });
});

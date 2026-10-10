import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/worker/auth";

describe("password hashing", () => {
  it("stores only a PBKDF2 hash and verifies it", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^pbkdf2-sha256\$/);
    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});

import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";

type Challenge = {
  message: string;
  nonce: string;
  expiresAt: number;
  used: boolean;
};

const challenges = new Map<string, Challenge>();

export function createChallenge() {
  const nonce = randomBytes(32).toString("hex");
  const message = [
    "Secure Vault wallet login",
    "",
    "Sign this message to prove wallet ownership.",
    "This request will not trigger a blockchain transaction.",
    "",
    `Nonce: ${nonce}`
  ].join("\n");

  const challenge = {
    message,
    nonce,
    expiresAt: Date.now() + env.AUTH_NONCE_TTL_MS,
    used: false
  };

  challenges.set(nonce, challenge);
  return challenge;
}

export function consumeChallenge(nonce: string, message: string) {
  const challenge = challenges.get(nonce);

  if (!challenge || challenge.used || challenge.message !== message || challenge.expiresAt <= Date.now()) {
    challenges.delete(nonce);
    return undefined;
  }

  challenge.used = true;
  challenges.delete(nonce);
  return challenge;
}

export function clearChallengesForTests() {
  challenges.clear();
}

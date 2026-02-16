import "server-only";

import { createHash, randomBytes } from "node:crypto";

const PKCE_MIN_LENGTH = 43;
const PKCE_MAX_LENGTH = 128;
const PKCE_ALLOWED_PATTERN = /^[A-Za-z0-9\-._~]+$/;

function toBase64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function assertCodeVerifier(codeVerifier: string) {
  if (
    codeVerifier.length < PKCE_MIN_LENGTH ||
    codeVerifier.length > PKCE_MAX_LENGTH ||
    !PKCE_ALLOWED_PATTERN.test(codeVerifier)
  ) {
    throw new Error("PKCE code verifier must be 43-128 unreserved URL characters");
  }
}

export function generateCodeVerifier() {
  return toBase64Url(randomBytes(32));
}

export function generateCodeChallengeS256(codeVerifier: string) {
  assertCodeVerifier(codeVerifier);
  const hash = createHash("sha256").update(codeVerifier).digest();
  return toBase64Url(hash);
}

export function generateState() {
  return toBase64Url(randomBytes(32));
}

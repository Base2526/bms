import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { serviceAuthClaimsSchema } from "@bms/fleet-delivery-contracts";

export type VerifiedServicePrincipal = {
  subject: string;
  jti: string;
  keyId?: string;
  scopes: ReadonlySet<string>;
};

export class ServiceAuthError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_FORBIDDEN" | "AUTH_REVOKED") {
    super(code);
    this.name = "ServiceAuthError";
  }
}

export function parseJwksJson(value: string): JSONWebKeySet {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("keys" in parsed) || !Array.isArray(parsed.keys)) {
    throw new Error("INVALID_SERVICE_JWKS");
  }
  return parsed as JSONWebKeySet;
}

export function createServiceTokenVerifier(input: {
  jwks: JSONWebKeySet;
  issuer: string;
  audience: string;
  isRevoked: (claims: {
    issuer: string;
    subject: string;
    jti: string;
    keyId?: string;
  }) => Promise<boolean>;
}) {
  const keySet = createLocalJWKSet(input.jwks);
  return async (authorization: string | undefined, requiredScope: string): Promise<VerifiedServicePrincipal> => {
    const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) throw new ServiceAuthError("AUTH_REQUIRED");
    try {
      const verified = await jwtVerify(token, keySet, {
        issuer: input.issuer,
        audience: input.audience,
        algorithms: ["EdDSA", "RS256", "ES256"],
        clockTolerance: 5,
        requiredClaims: ["sub", "jti", "iat", "exp"],
      });
      const claims = serviceAuthClaimsSchema.parse(verified.payload);
      const scopes = new Set(claims.scopes);
      if (!scopes.has(requiredScope)) throw new ServiceAuthError("AUTH_FORBIDDEN");
      const revocationInput = {
        issuer: input.issuer,
        subject: claims.sub,
        jti: claims.jti,
        ...(verified.protectedHeader.kid ? { keyId: verified.protectedHeader.kid } : {}),
      };
      if (await input.isRevoked(revocationInput)) throw new ServiceAuthError("AUTH_REVOKED");
      return {
        subject: claims.sub,
        jti: claims.jti,
        ...(verified.protectedHeader.kid ? { keyId: verified.protectedHeader.kid } : {}),
        scopes,
      };
    } catch (error) {
      if (error instanceof ServiceAuthError) throw error;
      throw new ServiceAuthError("AUTH_INVALID");
    }
  };
}

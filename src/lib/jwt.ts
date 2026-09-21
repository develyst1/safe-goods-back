import { sign, verify } from "hono/jwt";
import { env } from "../env";

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // SPEC-001: 24 h

export type TokenClaims = { sub: string; role: "USER" | "ADMIN"; exp: number };

export const signToken = (user: { id: string; role: string }): Promise<string> =>
  sign({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, env.JWT_SECRET, "HS256");

// Throws on a bad signature or an expired token.
export const verifyToken = (token: string) => verify(token, env.JWT_SECRET, "HS256") as Promise<TokenClaims>;

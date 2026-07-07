// types/next-auth.d.ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    provider?: string;
    accessToken?: string;
    accessTokenExpires?: number;

    user: DefaultSession["user"] & {
      id?: string;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    provider?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;

    facebookId?: string;
    picture?: string;
  }
}

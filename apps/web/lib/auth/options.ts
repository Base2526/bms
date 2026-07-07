// lib/auth/options.ts
import type { NextAuthOptions } from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";

export const authOptions: NextAuthOptions = {
  providers: [
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      authorization: {
        params: {
          scope: "public_profile,email",
          // optional but helps ensure we get picture/email in many setups:
          // fields: "id,name,email,picture",
        },
      },
    }),
  ],

  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",

  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        (token as any).provider = account.provider;
        (token as any).accessToken = account.access_token;
        (token as any).refreshToken = account.refresh_token;
        (token as any).accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : undefined;
      }

      if (profile) {
        const p = profile as any;
        (token as any).facebookId = p.id;
        token.name = p.name ?? token.name;
        token.email = p.email ?? token.email;
        (token as any).picture = p.picture?.data?.url ?? (token as any).picture;
      }

      return token;
    },

    async session({ session, token }) {
      session.user = session.user ?? ({} as any);

      (session.user as any).id = (token as any).facebookId ?? (session.user as any).id;
      session.user.name = (token.name as string) ?? session.user.name ?? null;
      session.user.email = (token.email as string) ?? session.user.email ?? null;
      (session.user as any).image =
        ((token as any).picture as string) ?? (session.user as any).image ?? null;

      (session as any).provider = (token as any).provider;
      (session as any).accessToken = (token as any).accessToken;
      (session as any).accessTokenExpires = (token as any).accessTokenExpires;

      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
};

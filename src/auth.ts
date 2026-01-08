import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getUserIdByProviderUserId, upsertUser } from "@/db/translationRepo";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user && account.providerAccountId) {
        try {
          await upsertUser({
            provider: "google",
            providerUserId: account.providerAccountId,
            email: user.email ?? undefined,
            name: user.name ?? undefined,
            imageUrl: user.image ?? undefined,
          });
        } catch (error) {
          console.error("Failed to upsert user:", error);
          // Allow login to proceed even if DB fails
        }
      }
      return true;
    },
    async jwt({ token, account }) {
      // Store Google's provider ID in the token on first sign in
      if (account?.provider === "google" && account.providerAccountId) {
        token.providerAccountId = account.providerAccountId;
        console.log(
          "[JWT] Stored providerAccountId in token:",
          account.providerAccountId
        );
      }
      return token;
    },
    async session({ session, token }) {
      console.log(
        "[Session] Token providerAccountId:",
        token.providerAccountId
      );
      if (session.user && token.providerAccountId) {
        // Attach internal app_user.id to session
        const userId = await getUserIdByProviderUserId(
          "google",
          token.providerAccountId as string
        );
        if (userId) {
          session.user.id = userId;
          console.log("[Session] Attached userId to session:", userId);
        } else {
          console.error(
            "[Session] Failed to find user in DB for providerAccountId:",
            token.providerAccountId
          );
        }
      } else {
        console.error("[Session] Missing providerAccountId in token");
      }
      return session;
    },
  },
  debug: process.env.NODE_ENV === "development",
  // bump deployment with new secret
});

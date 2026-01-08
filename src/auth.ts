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
    async session({ session, token }) {
      if (session.user && token.sub) {
        // Attach internal app_user.id to session
        const userId = await getUserIdByProviderUserId("google", token.sub);
        if (userId) {
          session.user.id = userId;
        }
      }
      return session;
    },
  },
  // debug: process.env.NODE_ENV === "development", // debug
  // bump deployment with new secret
});

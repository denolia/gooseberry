import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub!;
      }
      return session;
    },
  },
  // debug: process.env.NODE_ENV === "development", // debug
  // bump deployment with new secret
});

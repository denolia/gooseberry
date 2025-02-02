import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  // debug: process.env.NODE_ENV === "development", // Enable verbose logging in development
});

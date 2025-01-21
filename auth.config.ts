import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      if (isOnLogin) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/", nextUrl)); // home page
        } else {
          return true;
        }
        // Redirect unauthenticated users to login page
      } else {
        return isLoggedIn;
      }
    },
  },
  providers: [], // Add providers with an empty array for now
} satisfies NextAuthConfig;

// auth.js
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        await initDb();
        if (!credentials?.username || !credentials?.password) return null;

        const result = await pool.query(
          "SELECT * FROM users WHERE username = $1",
          [credentials.username]
        );

        // if (credentials.username === "admin" && credentials.password === "password") {
        //   return {
        //     id: 0,
        //     name: "Admin",
        //     username: "admin",
        //     role: "admin",
        //   };
        // }
        
        try {
          const result = await pool.query(
            "SELECT * FROM users WHERE username = $1",
            [credentials.username]
          );
          const user = result.rows[0];

          if (!user) {
            console.log("No user found:", credentials.username);
            return null;
          }

          const valid = await bcrypt.compare(credentials.password, user.password);
          if (!valid) {
            console.log("Invalid password for user:", credentials.username);
            return null;
          }

          return {
            id: user.id,
            name: user.username,
            username: user.username,
            email: user.email,
            role: user.role,
          };
        } catch (err) {
          console.error("Database error in authorize:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.username = token.username;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  debug: process.env.NODE_ENV === "development",
});
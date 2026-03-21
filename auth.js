import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

function makeSafeUsername(nameOrEmail) {
  return String(nameOrEmail || "user")
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30) || "user";
}

async function getUniqueUsername(base) {
  let candidate = base;
  let counter = 1;

  while (true) {
    const check = await pool.query(
      "SELECT id FROM users WHERE username = $1 LIMIT 1",
      [candidate]
    );

    if (check.rows.length === 0) return candidate;

    candidate = `${base}_${counter}`;
    counter += 1;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),

    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        await initDb();

        if (!credentials?.username || !credentials?.password) {
          return null;
        }

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
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        await initDb();

        try {
          // 1. Look up by email
          const existingByEmail = await pool.query(
            "SELECT * FROM users WHERE email = $1 LIMIT 1",
            [user.email]
          );

          if (existingByEmail.rows.length > 0) {
            const dbUser = existingByEmail.rows[0];
            user.id = dbUser.id;
            user.role = dbUser.role || "user";
            user.username = dbUser.username;
            return true;
          }

          // 2. Create new user if not found
          const baseUsername = makeSafeUsername(user.name || user.email);
          const uniqueUsername = await getUniqueUsername(baseUsername);

          const inserted = await pool.query(
            `
            INSERT INTO users (username, email, role)
            VALUES ($1, $2, $3)
            RETURNING id, username, email, role
            `,
            [uniqueUsername, user.email, "user"]
          );

          const dbUser = inserted.rows[0];
          user.id = dbUser.id;
          user.role = dbUser.role;
          user.username = dbUser.username;

          return true;
        } catch (err) {
          console.error("Google sign-in DB sync error:", err);
          return false;
        }
      }

      return true;
    },

    async jwt({ token, user, profile, account }) {
      if (user) {
        token.id = user.id;
        token.role = user.role || "user";
        token.username =
          user.username ||
          user.name ||
          profile?.name ||
          token.username;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.username = token.username;
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
});
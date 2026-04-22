import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { initDb } from "@/lib/initDb";

function makeSafeUsername(nameOrEmail) {
  return (
    String(nameOrEmail || "user")
      .toLowerCase()
      .replace(/@.*$/, "")
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "user"
  );
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
      checks: ["pkce"],
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),

    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" },
      },

      async authorize(credentials) {
        await initDb();

        if (!credentials?.username || !credentials?.password) {
          console.log("AUTH DEBUG: missing credentials");
          return null;
        }

        try {
          const loginInput = String(credentials.username).trim();
          const plainPassword = String(credentials.password);

          console.log("AUTH DEBUG: login attempt", {
            loginInput,
            passwordLength: plainPassword.length,
          });

          const result = await pool.query(
            `
            SELECT *
            FROM users
            WHERE username = $1
               OR LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [loginInput]
          );

          const user = result.rows[0];

          if (!user) {
            console.log("AUTH DEBUG: no user found");
            return null;
          }

          console.log("AUTH DEBUG: user found", {
            id: user.id,
            username: user.username,
            email: user.email,
            dbPasswordLength: user.password?.length,
            dbPasswordPreview: user.password?.slice(0, 20),
          });

          if (!user.password) {
            console.log("AUTH DEBUG: user has no password set");
            return null;
          }

          const valid = await bcrypt.compare(plainPassword, user.password);

          console.log("AUTH DEBUG: bcrypt match =", valid);

          if (!valid) {
            return null;
          }

          return {
            id: String(user.id),
            name: user.username,
            username: user.username,
            email: user.email,
            role: user.role || "user",
          };
        } catch (err) {
          console.error("AUTH DEBUG: authorize error", err);
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
          const existingByEmail = await pool.query(
            "SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [user.email]
          );

          if (existingByEmail.rows.length > 0) {
            const dbUser = existingByEmail.rows[0];
            user.id = String(dbUser.id);
            user.role = dbUser.role || "user";
            user.username = dbUser.username;
            user.email = dbUser.email;
            return true;
          }

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
          user.id = String(dbUser.id);
          user.role = dbUser.role || "user";
          user.username = dbUser.username;
          user.email = dbUser.email;

          return true;
        } catch (err) {
          console.error("Google sign-in DB sync error:", err);
          return false;
        }
      }

      return true;
    },

    async jwt({ token, user, profile }) {
      if (user) {
        token.id = user.id;
        token.role = user.role || "user";
        token.username =
          user.username || user.name || profile?.name || token.username;
        token.email = user.email || token.email;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.username = token.username;
        session.user.email = token.email;
      }

      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.AUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
});
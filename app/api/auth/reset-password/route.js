import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { initDb } from '@/lib/initDb';

export async function POST(req) {
  try {
    await initDb();

    const { email, token, password } = await req.json();

    if (!email || !token || !password) {
      return NextResponse.json(
        { error: 'Email, token, and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await pool.query(
      `
      SELECT id, username, email, reset_token, reset_token_expires
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid reset request' },
        { status: 400 }
      );
    }

    const user = userResult.rows[0];

    if (!user.reset_token || !user.reset_token_expires) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 400 }
      );
    }

    if (new Date(user.reset_token_expires) < new Date()) {
      return NextResponse.json(
        { error: 'Reset token has expired' },
        { status: 400 }
      );
    }

    const tokenMatches = await bcrypt.compare(token, user.reset_token);

    console.log("RESET DEBUG: token check", {
      userId: user.id,
      username: user.username,
      email: user.email,
      tokenMatches,
    });

    if (!tokenMatches) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const selfTestMatch = await bcrypt.compare(password, hashedPassword);

    console.log("RESET DEBUG: before save", {
      userId: user.id,
      username: user.username,
      email: user.email,
      newPasswordLength: password.length,
      hashedPasswordLength: hashedPassword.length,
      hashedPasswordPreview: hashedPassword.slice(0, 20),
      selfTestMatch,
    });

    await pool.query(
      `
      UPDATE users
      SET password = $1,
          reset_token = NULL,
          reset_token_expires = NULL
      WHERE id = $2
      `,
      [hashedPassword, user.id]
    );

    const verifyRow = await pool.query(
      `
      SELECT id, username, email, password, reset_token, reset_token_expires
      FROM users
      WHERE id = $1
      `,
      [user.id]
    );

    console.log("RESET DEBUG: after save", {
      id: verifyRow.rows[0]?.id,
      username: verifyRow.rows[0]?.username,
      email: verifyRow.rows[0]?.email,
      savedPasswordLength: verifyRow.rows[0]?.password?.length,
      savedPasswordPreview: verifyRow.rows[0]?.password?.slice(0, 20),
      resetTokenCleared: verifyRow.rows[0]?.reset_token === null,
      resetExpiryCleared: verifyRow.rows[0]?.reset_token_expires === null,
    });

    return NextResponse.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('RESET PASSWORD ERROR:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
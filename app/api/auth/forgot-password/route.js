import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { initDb } from '@/lib/initDb';
import transporter from '@/lib/mailer';

export async function POST(req) {
  try {
    await initDb();

    const { email } = await req.json();

    if (!email || !email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [normalizedEmail]
    );

    // Do not reveal whether user exists
    if (userResult.rows.length === 0) {
      return NextResponse.json({
        message: 'If an account exists, a reset link has been sent.',
      });
    }

    const user = userResult.rows[0];

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(rawToken, 10);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 mins

    await pool.query(
      `
      UPDATE users
      SET reset_token = $1,
          reset_token_expires = $2
      WHERE id = $3
      `,
      [hashedToken, expiresAt, user.id]
    );

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    await transporter.sendMail({
      from: `"Photo App" <${process.env.EMAIL_SERVER_USER}>`,
      to: user.email,
      subject: 'Reset your password',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>Reset your password</h2>
          <p>Click the button below to set a new password:</p>
          <p>
            <a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">
              Reset Password
            </a>
          </p>
          <p>This link expires in 30 minutes.</p>
          <p>If you didn’t request this, ignore this email.</p>
        </div>
      `,
    });

    return NextResponse.json({
      message: 'If an account exists, a reset link has been sent.',
    });
  } catch (error) {
    console.error('FORGOT PASSWORD ERROR:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
import { NextResponse } from 'next/server';
import transporter from '@/lib/mailer';

export async function GET() {
  try {
    await transporter.sendMail({
      from: `"Photo App" <${process.env.EMAIL_SERVER_USER}>`,
      to: process.env.EMAIL_SERVER_USER, // send to yourself
      subject: 'Test Email',
      text: 'If you see this, your email setup works.',
    });

    return NextResponse.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    );
  }
}
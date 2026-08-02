import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "fallback_secret_only_for_dev");

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    const expectedUsername = process.env.ADMIN_USERNAME;
    const expectedPasswordHash = process.env.ADMIN_PASSWORD;

    if (!expectedUsername || !expectedPasswordHash) {
      return NextResponse.json({ error: "Server missing admin credentials." }, { status: 500 });
    }

    const isPasswordValid = bcrypt.compareSync(password, expectedPasswordHash);

    if (username === expectedUsername && isPasswordValid) {
      const token = await new SignJWT({ admin: true })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(JWT_SECRET);

      const response = NextResponse.json({ success: true });
      response.cookies.set("tiffin_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      });

      return response;
    }

    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
}

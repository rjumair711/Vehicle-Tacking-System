import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

const checkEmailSchema = z.object({
  step: z.literal("check-email"),
  email: z.string().email(),
});

const resetSchema = z.object({
  step: z.literal("reset"),
  email: z.string().email(),
  newPassword: z.string().min(6),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Step 1: verify email exists
    if (body.step === "check-email") {
      const parsed = checkEmailSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ message: "Invalid input" }, { status: 400 });
      }

      const { email } = parsed.data;

      // Block admin from using this flow
      if (email === "admin@fleettrack.com") {
        return NextResponse.json(
          { message: "Invalid email" },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return NextResponse.json(
          { message: "No account found with this email" },
          { status: 404 }
        );
      }

      return NextResponse.json({ message: "Email verified" });
    }

    // Step 2: update password
    if (body.step === "reset") {
      const parsed = resetSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ message: "Invalid input" }, { status: 400 });
      }

      const { email, newPassword } = parsed.data;

      if (email === "admin@fleettrack.com") {
        return NextResponse.json(
          { message: "Invalid email" },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return NextResponse.json(
          { message: "No account found with this email" },
          { status: 404 }
        );
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { email },
        data: { passwordHash },
      });

      return NextResponse.json({ message: "Password updated successfully" });
    }

    return NextResponse.json({ message: "Invalid step" }, { status: 400 });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
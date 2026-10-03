import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, getSession, unauthorized } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!session.isAdmin) return forbidden();

  try {
    const { id } = await params;
    const userId = Number(id);

    if (!userId || isNaN(userId)) {
      return NextResponse.json(
        { message: "Invalid user ID" },
        { status: 400 }
      );
    }

    if (userId === session.userId) {
      return NextResponse.json(
        { message: "The admin account cannot be deleted" },
        { status: 400 }
      );
    }

    // Deleting a customer also deletes their trackers and tracking data.
    await prisma.user.delete({
      where: { userId },
    });

    return NextResponse.json({
      message: "Customer deleted successfully",
    });
  } catch (error) {
    console.error("Delete customer error:", error);
    return NextResponse.json(
      { message: "Failed to delete customer" },
      { status: 500 }
    );
  }
}

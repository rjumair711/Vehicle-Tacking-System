import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const userId = Number(params.id);

    if (!userId) {
      return NextResponse.json(
        { message: "Invalid user ID" },
        { status: 400 }
      );
    }

    await prisma.user.delete({
      where: {
        userId: userId,
      },
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
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: { trackerId: string } }
) {
  try {
    const tracker = await prisma.tracker.findUnique({
      where: {
        trackerId: params.trackerId,
      },
      include: {
        user: {
          select: {
            userId: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!tracker) {
      return NextResponse.json(
        { message: "Tracker not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ tracker });
  } catch (error) {
    console.error("Fetch tracker error:", error);
    return NextResponse.json(
      { message: "Failed to fetch tracker" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { trackerId: string } }
) {
  try {
    await prisma.tracker.delete({
      where: {
        trackerId: params.trackerId,
      },
    });

    return NextResponse.json({
      message: "Tracker deleted successfully",
    });
  } catch (error) {
    console.error("Delete tracker error:", error);
    return NextResponse.json(
      { message: "Failed to delete tracker" },
      { status: 500 }
    );
  }
}
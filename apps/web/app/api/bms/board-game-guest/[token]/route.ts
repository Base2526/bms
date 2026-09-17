import { NextResponse, type NextRequest } from "next/server";
import { getBoardGameGuestContext } from "@/lib/bms/boardGameServiceCalls";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  boardGameGuestError,
  requireBoardGameGuestRateLimit,
} from "../routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const limited = await requireBoardGameGuestRateLimit(req, "open", 30);
  if (limited) return limited;
  try {
    const context = await getBoardGameGuestContext(params.token);
    return NextResponse.json({
      status: "READY",
      storeName: context.storeName,
      locationName: context.locationName,
      tableCode: context.tableCode,
      tableName: context.tableName,
      billingMode: context.billingMode,
    });
  } catch (error) {
    return boardGameGuestError(error);
  }
}

export const GET = withRouteErrorLog(
  "GET /api/bms/board-game-guest/[token]",
  handleGET
);

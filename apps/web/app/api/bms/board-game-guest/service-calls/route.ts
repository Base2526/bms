import { NextResponse, type NextRequest } from "next/server";
import {
  createBoardGameServiceCall,
  listBoardGameGuestCalls,
} from "@/lib/bms/boardGameServiceCalls";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  boardGameGuestError,
  boardGameGuestToken,
  requireBoardGameGuestRateLimit,
} from "../routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const limited = await requireBoardGameGuestRateLimit(req, "status", 60);
  if (limited) return limited;
  try {
    return NextResponse.json({
      calls: await listBoardGameGuestCalls(boardGameGuestToken(req)),
    });
  } catch (error) {
    return boardGameGuestError(error);
  }
}

async function handlePOST(req: NextRequest) {
  const limited = await requireBoardGameGuestRateLimit(req, "submit", 6);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await createBoardGameServiceCall({
      publicToken: boardGameGuestToken(req),
      idempotencyKey:
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      requestCode: typeof body.requestCode === "string" ? body.requestCode : "",
      requestNote:
        typeof body.requestNote === "string" ? body.requestNote : null,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return boardGameGuestError(error);
  }
}

export const GET = withRouteErrorLog(
  "GET /api/bms/board-game-guest/service-calls",
  handleGET
);
export const POST = withRouteErrorLog(
  "POST /api/bms/board-game-guest/service-calls",
  handlePOST
);

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRestaurantMutation } from '../routeAuth';
import { listRestaurantRequests, reviewRestaurantRequest } from '@/lib/bms/restaurantRequests';
import { withRouteErrorLog } from '@/lib/log/routeError';

export const dynamic = 'force-dynamic';
// This queue includes callback numbers, so even reads require a cashier PIN.
async function handlePOST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const auth = await authenticateRestaurantMutation(req,body,'pos.sell');
  if (!auth.ok) return NextResponse.json({error:auth.error},{status:auth.status});
  try {
    if (body.action === 'list') return NextResponse.json({requests:await listRestaurantRequests({
      tenantId:auth.device.tenantId,locationId:auth.device.locationId,actorUserId:auth.actor.userId})});
    const result = await reviewRestaurantRequest({tenantId:auth.device.tenantId,locationId:auth.device.locationId,
      actorUserId:auth.actor.userId,id:String(body.id ?? ''),version:body.version,action:body.action,
      quantities:body.quantities,note:typeof body.note === 'string' ? body.note : '',
      kitchenNote:typeof body.kitchenNote === 'string' ? body.kitchenNote : undefined,confirmed:body.confirmed === true});
    return NextResponse.json(result,{status:result.status === 'REVIEW_REQUIRED' ? 409 : 200});
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    return NextResponse.json({error:error instanceof Error ? error.message : 'ตรวจคำขอไม่สำเร็จ'},{status:400});
  }
}
export const POST = withRouteErrorLog('POST /api/pos/restaurant/requests', handlePOST);

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdminRoute } from '@/lib/bms/adminRouteAuth';
import { listRestaurantRequests, reviewRestaurantRequest } from '@/lib/bms/restaurantRequests';
import { getStoreProfile } from '@/lib/bms/storeProfile';
import { withRouteErrorLog } from '@/lib/log/routeError';

export const dynamic = 'force-dynamic';
async function handleGET() {
  const auth = await authorizeAdminRoute('order.view');
  if (!auth.ok) return NextResponse.json({error:'Unauthorized'},{status:auth.status});
  const enabled = (await getStoreProfile(auth.tenantId)).businessArchetype === 'restaurant';
  return NextResponse.json({ enabled, requests: enabled ? await listRestaurantRequests({tenantId:auth.tenantId,actorUserId:String(auth.adminId)}) : [] });
}
async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute('order.create');
  if (!auth.ok) return NextResponse.json({error:'Unauthorized'},{status:auth.status});
  try {
    const body = await req.json();
    const result = await reviewRestaurantRequest({tenantId:auth.tenantId,actorUserId:String(auth.adminId),
      locationId:String(body.locationId ?? ''),id:String(body.id ?? ''),version:body.version,
      action:body.action,quantities:body.quantities,note:typeof body.note === 'string' ? body.note : '',
      kitchenNote:typeof body.kitchenNote === 'string' ? body.kitchenNote : undefined,confirmed:body.confirmed === true});
    return NextResponse.json(result,{status:result.status === 'REVIEW_REQUIRED' ? 409 : 200});
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    return NextResponse.json({error:error instanceof Error ? error.message : 'ตรวจคำขอไม่สำเร็จ'},{status:400});
  }
}
export const GET = withRouteErrorLog('GET /api/bms/restaurant-requests', handleGET);
export const POST = withRouteErrorLog('POST /api/bms/restaurant-requests', handlePOST);

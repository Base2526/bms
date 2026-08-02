import OperationsScheduleClient from "./OperationsScheduleClient";
import { listOperationSchedules } from "@/lib/bms/operationsSchedule";

export default async function OperationsSchedulePage() {
  const rows = await listOperationSchedules();
  return <OperationsScheduleClient rows={rows} />;
}

import { listPlans } from "@/lib/bms/plans";
import HomePageClient from "./HomePageClient";

export default function HomePage() {
  // Start the public-only database read without delaying the hero stream.
  // A failed read falls back to the existing client GraphQL request.
  const initialPlans = listPlans().catch(() => []);
  return <HomePageClient initialPlans={initialPlans} />;
}

import DashboardClient from "./dashboard-client";
import { dashboardView } from "./research-data";

export default function Home() {
  return <DashboardClient data={dashboardView} />;
}

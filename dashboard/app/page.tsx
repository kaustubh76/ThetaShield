import DashboardClient from "./dashboard-client";
import { deploymentView } from "./deployment-data";
import { dashboardView } from "./research-data";

export default function Home() {
  return <DashboardClient data={dashboardView} deployment={deploymentView} />;
}

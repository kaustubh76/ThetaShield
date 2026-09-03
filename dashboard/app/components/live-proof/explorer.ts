import type { DeploymentView } from "../../deployment-data";

// Explorer bases come from the manifest through DeploymentView, which client
// components already receive as a prop. Importing deployment-data directly here
// would pull the research bundle into the client bundle with it.
export function txUrlFor(deployment: DeploymentView, role: "origin" | "processor") {
  const base = deployment.networks.find((network) => network.role === role)?.explorerBase ?? "";
  return (hash: string) => `${base}/tx/${hash}`;
}

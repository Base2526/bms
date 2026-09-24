export type BmsDeploymentMode = "cloud" | "retail-local";

export function deploymentMode(): BmsDeploymentMode {
  return process.env.BMS_DEPLOYMENT_MODE === "retail-local" ? "retail-local" : "cloud";
}

export function isRetailLocalDeployment(): boolean {
  return deploymentMode() === "retail-local";
}


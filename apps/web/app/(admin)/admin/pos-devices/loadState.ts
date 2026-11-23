export type PosSetupLoadState =
  | "permissions-loading"
  | "permissions-error"
  | "denied"
  | "data-loading"
  | "data-error"
  | "ready";

export function posSetupLoadState(input: {
  permissionsLoading: boolean;
  permissionsError: boolean;
  hasPermission: boolean;
  dataLoading: boolean;
  dataError: boolean;
  hasData: boolean;
}): PosSetupLoadState {
  if (input.permissionsError) return "permissions-error";
  if (input.permissionsLoading && !input.hasPermission) return "permissions-loading";
  if (!input.hasPermission) return "denied";
  if (input.dataError) return "data-error";
  if (input.dataLoading && !input.hasData) return "data-loading";
  if (!input.hasData) return "data-error";
  return "ready";
}

import { inject, type InjectionKey } from "vue";
import type { Workspace } from "./api";

export interface WorkspaceFormServices {
  chooseParent: (pick: boolean) => Promise<Workspace | null>;
  preflight: (parent: string, name: string) => Promise<string>;
  validationKey?: () => unknown;
}
export const workspaceFormServices: InjectionKey<WorkspaceFormServices> =
  Symbol("workspace-form-services");
export function useWorkspaceFormServices(): WorkspaceFormServices {
  const services = inject(workspaceFormServices);
  if (!services)
    throw new Error("Workspace simulation services are unavailable.");
  return services;
}

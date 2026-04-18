import type { MapProject } from "./types";

export function isValidProject(project: unknown): project is MapProject {
  const p = project as MapProject;
  if (!p || p.version !== 1 || !Array.isArray(p.roads) || !Array.isArray(p.buildings)) {
    return false;
  }
  return true;
}

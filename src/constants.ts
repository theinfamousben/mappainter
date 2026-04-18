import type { BuildingType, RoadType } from "./types";

export const ROAD_STYLES: Record<RoadType, { color: string; edge: string }> = {
  street: { color: "#6f786f", edge: "#4f5650" },
  avenue: { color: "#5f695f", edge: "#454d45" },
  highway: { color: "#52595a", edge: "#393f40" }
};

export const BUILDING_COLORS: Record<BuildingType, string> = {
  residential: "#d6b89e",
  commercial: "#b1b6c9",
  industrial: "#bea88a"
};

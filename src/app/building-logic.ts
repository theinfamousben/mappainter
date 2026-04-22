import { lanePixels, segmentIntersectsRect } from "../geometry";
import type { Building, BuildingType, Rect, Road, RoadType } from "../types";
import { nextId } from "../utils";

export function generateAutoBuildings(roads: Road[], existingBuildings: Building[]): {
  buildings: Building[];
  created: number;
} {
  const buildings = existingBuildings.filter((b) => b.source === "manual");
  let created = 0;

  for (const road of roads) {
    for (let i = 1; i < road.points.length; i += 1) {
      const a = road.points[i - 1];
      const b = road.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 20) {
        continue;
      }

      const nx = -dy / length;
      const ny = dx / length;
      const spacing = 38;
      const count = Math.floor(length / spacing);
      const halfRoad = lanePixels(road) * 0.5;

      for (let n = 1; n <= count; n += 1) {
        const t = (n * spacing) / length;
        const cx = a.x + dx * t;
        const cy = a.y + dy * t;

        for (const side of [-1, 1] as const) {
          const depth = 18 + ((n + (side === 1 ? 2 : 0)) % 3) * 5;
          const width = 16 + ((n + (side === 1 ? 1 : 0)) % 4) * 4;
          const offset = halfRoad + 12 + depth * 0.5;

          const centerX = cx + nx * side * offset;
          const centerY = cy + ny * side * offset;

          const candidate: Building = {
            id: nextId("building"),
            source: "auto",
            type: inferBuildingType(road.type, n),
            x: centerX - width * 0.5,
            y: centerY - depth * 0.5,
            width,
            height: depth
          };

          if (!collidesBuilding(candidate, buildings) && !collidesWithRoadNetwork(candidate, roads)) {
            buildings.push(candidate);
            created += 1;
          }
        }
      }
    }
  }

  return { buildings, created };
}

export function inferBuildingType(roadType: RoadType, index: number): BuildingType {
  if (roadType === "highway") {
    return index % 2 === 0 ? "industrial" : "commercial";
  }
  if (roadType === "avenue") {
    return index % 3 === 0 ? "commercial" : "residential";
  }
  return index % 5 === 0 ? "commercial" : "residential";
}

export function collidesBuilding(candidate: Building, buildings: Building[]): boolean {
  for (const existing of buildings) {
    if (
      candidate.x < existing.x + existing.width &&
      candidate.x + candidate.width > existing.x &&
      candidate.y < existing.y + existing.height &&
      candidate.y + candidate.height > existing.y
    ) {
      return true;
    }
  }
  return false;
}

export function collidesWithRoadNetwork(candidate: Building, roads: Road[]): boolean {
  for (const road of roads) {
    if (buildingCollidesWithRoad(candidate, road)) {
      return true;
    }
  }
  return false;
}

export function pruneConflictingBuildings(buildings: Building[], roads: Road[]): {
  buildings: Building[];
  removed: number;
} {
  const filtered = buildings.filter((building) => !collidesWithRoadNetwork(building, roads));
  return { buildings: filtered, removed: buildings.length - filtered.length };
}

function buildingCollidesWithRoad(building: Building, road: Road): boolean {
  if (road.points.length < 2) {
    return false;
  }

  const halfWidth = lanePixels(road) * 0.5;
  const expanded: Rect = {
    x: building.x - halfWidth,
    y: building.y - halfWidth,
    width: building.width + halfWidth * 2,
    height: building.height + halfWidth * 2
  };

  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    if (segmentIntersectsRect(a, b, expanded)) {
      return true;
    }
  }

  return false;
}
import { lanePixels, pointToSegmentDistance } from "../geometry";
import type { Building, Point, Road } from "../types";

export function findBuildingAt(point: Point, buildings: Building[]): Building | null {
  for (let i = buildings.length - 1; i >= 0; i -= 1) {
    const b = buildings[i];
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return b;
    }
  }
  return null;
}

export function findRoadAt(point: Point, roads: Road[], cameraZoom: number): Road | null {
  const tolerance = 10 / cameraZoom;
  for (let i = roads.length - 1; i >= 0; i -= 1) {
    const road = roads[i];
    for (let p = 1; p < road.points.length; p += 1) {
      const distance = pointToSegmentDistance(point, road.points[p - 1], road.points[p]);
      const width = lanePixels(road) * 0.5 + tolerance;
      if (distance <= width) {
        return road;
      }
    }
  }
  return null;
}
import {
    dedupeConsecutivePoints,
    lanePixels,
    normalize,
    samePoint,
    segmentIntersectionWithParameters,
} from "../geometry";
import type {
    EntryPoint,
    IntersectionInfo,
    n_IntersectionInfo,
    Point,
    Road,
} from "../types";
import { nextId } from "../utils";
import { MINIMUM_INTERSECTION_VICINITY } from "../constants";

export function combineIntersections(
    intersections: IntersectionInfo[],
): n_IntersectionInfo[] {
    const combined: n_IntersectionInfo[] = [];
    const minDistance = MINIMUM_INTERSECTION_VICINITY;

    for (const info of intersections) {
        const existing = combined.find(
            (combinedInfo) =>
                Math.hypot(
                    combinedInfo.point.x - info.point.x,
                    combinedInfo.point.y - info.point.y,
                ) < minDistance,
        );
        if (!existing) {
            const _info: n_IntersectionInfo = {
                point: info.point,
                roadIds: [info.roadAId, info.roadBId],
                widths: [info.widthA, info.widthB],
                directions: [info.dirA, info.dirB],
                entryPoints: [],
            };
            combined.push(_info);
        }
    }

    return combined;
}

function calculateEntryPoints(intersection: n_IntersectionInfo): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    for (const roadId of intersection.roadIds) {
        const road: Road = getRoadById(roadId);
        const lastPoint = road.points[road.points.length - 1];
        const angle = Math.pow(
            Math.tan(
                (intersection.point.y - lastPoint.y) /
                (intersection.point.x - lastPoint.x)
            ),
            -1
        )

        
    }
    return entryPoints;
}

function getRoadById(roadId: string): Road {
    throw new Error("getRoadById not implemented");
}

export function calculateIntersectionsDetailed(
    roads: Road[],
): IntersectionInfo[] {
    const intersections: IntersectionInfo[] = [];

    for (let i = 0; i < roads.length; i += 1) {
        const aRoad = roads[i];
        for (let j = i + 1; j < roads.length; j += 1) {
            const bRoad = roads[j];

            if (aRoad.type === "highway" || bRoad.type === "highway") {
                continue;
            }

            for (let sa = 1; sa < aRoad.points.length; sa += 1) {
                const a1 = aRoad.points[sa - 1];
                const a2 = aRoad.points[sa];
                for (let sb = 1; sb < bRoad.points.length; sb += 1) {
                    const b1 = bRoad.points[sb - 1];
                    const b2 = bRoad.points[sb];
                    const hit = segmentIntersectionWithParameters(
                        a1,
                        a2,
                        b1,
                        b2,
                    );
                    if (!hit) {
                        continue;
                    }

                    const duplicate = intersections.some(
                        (info) =>
                            Math.hypot(
                                info.point.x - hit.point.x,
                                info.point.y - hit.point.y,
                            ) < 2,
                    );
                    if (duplicate) {
                        continue;
                    }

                    intersections.push({
                        point: hit.point,
                        roadAId: aRoad.id,
                        roadBId: bRoad.id,
                        widthA: lanePixels(aRoad),
                        widthB: lanePixels(bRoad),
                        dirA: normalize({ x: a2.x - a1.x, y: a2.y - a1.y }),
                        dirB: normalize({ x: b2.x - b1.x, y: b2.y - b1.y }),
                    });
                }
            }
        }
    }

    return intersections;
}

export function splitRoadNetworkAtIntersections(roads: Road[]): Road[] {
    const epsilon = 0.001;
    const splitMap = new Map<
        string,
        Map<number, Array<{ t: number; point: Point }>>
    >();

    for (const road of roads) {
        splitMap.set(road.id, new Map());
    }

    for (let i = 0; i < roads.length; i += 1) {
        const aRoad = roads[i];
        for (let j = i + 1; j < roads.length; j += 1) {
            const bRoad = roads[j];
            if (aRoad.type === "highway" || bRoad.type === "highway") {
                continue;
            }

            for (let sa = 1; sa < aRoad.points.length; sa += 1) {
                const a1 = aRoad.points[sa - 1];
                const a2 = aRoad.points[sa];
                for (let sb = 1; sb < bRoad.points.length; sb += 1) {
                    const b1 = bRoad.points[sb - 1];
                    const b2 = bRoad.points[sb];
                    const hit = segmentIntersectionWithParameters(
                        a1,
                        a2,
                        b1,
                        b2,
                    );
                    if (!hit) {
                        continue;
                    }

                    if (hit.tA > epsilon && hit.tA < 1 - epsilon) {
                        addSplitPoint(
                            splitMap,
                            aRoad.id,
                            sa,
                            hit.tA,
                            hit.point,
                        );
                    }
                    if (hit.tB > epsilon && hit.tB < 1 - epsilon) {
                        addSplitPoint(
                            splitMap,
                            bRoad.id,
                            sb,
                            hit.tB,
                            hit.point,
                        );
                    }
                }
            }
        }
    }

    const rebuilt: Road[] = [];
    for (const road of roads) {
        const bySegment = splitMap.get(road.id);
        if (!bySegment || bySegment.size === 0) {
            rebuilt.push(road);
            continue;
        }

        let current: Point[] = [road.points[0]];
        for (let seg = 1; seg < road.points.length; seg += 1) {
            const segmentEnd = road.points[seg];
            const splits = [...(bySegment.get(seg) ?? [])].sort(
                (a, b) => a.t - b.t,
            );

            for (const split of splits) {
                if (!samePoint(current[current.length - 1], split.point)) {
                    current.push(split.point);
                }
                if (current.length >= 2) {
                    rebuilt.push({
                        ...road,
                        id: nextId("road"),
                        points: dedupeConsecutivePoints(current),
                    });
                }
                current = [split.point];
            }

            if (!samePoint(current[current.length - 1], segmentEnd)) {
                current.push(segmentEnd);
            }
        }

        if (current.length >= 2) {
            rebuilt.push({
                ...road,
                id: nextId("road"),
                points: dedupeConsecutivePoints(current),
            });
        }
    }

    return rebuilt.filter((road) => road.points.length >= 2);
}

function addSplitPoint(
    splitMap: Map<string, Map<number, Array<{ t: number; point: Point }>>>,
    roadId: string,
    segmentIndex: number,
    t: number,
    point: Point,
) {
    const roadMap = splitMap.get(roadId);
    if (!roadMap) {
        return;
    }
    const list = roadMap.get(segmentIndex) ?? [];
    const duplicate = list.some(
        (entry) =>
            Math.hypot(entry.point.x - point.x, entry.point.y - point.y) < 1.5,
    );
    if (!duplicate) {
        list.push({ t, point });
    }
    roadMap.set(segmentIndex, list);
}

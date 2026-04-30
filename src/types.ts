export type Tool = "select" | "road" | "building";
export type RoadType = "street" | "avenue" | "highway";
export type RoadDrawMode = "straight" | "curve";
export type BuildingType = "residential" | "commercial" | "industrial";

export type Point = {
    x: number;
    y: number;
};

export type Road = {
    id: string;
    type: RoadType;
    lanes: number;
    points: Point[];
    bidirectional: boolean;
};

export type Building = {
    id: string;
    type: BuildingType;
    source: "manual" | "auto";
    x: number;
    y: number;
    width: number;
    height: number;
};

export type Selection =
    | { kind: "none" }
    | { kind: "road"; id: string }
    | { kind: "building"; id: string };

export type MapProject = {
    version: 1;
    roads: Road[];
    buildings: Building[];
};

export type Camera = {
    x: number;
    y: number;
    zoom: number;
};

export type route = {
    roadIds: string[];
    totalLength: number;
    name: string;
    routeId: string;
};

export type n_IntersectionInfo = {
    intersectionId: string;
    point: Point;
    roadIds: string[];
    widths: number[];
    directions: Point[];
    entryPoints: EntryPoint[];
};

export type EntryPoint = {
    id: string;
    position: Point; // Position relative to the intersection point
    direction: "in" | "out";
};

export type IntersectionInfo = {
    point: Point;
    roadAId: string;
    roadBId: string;
    widthA: number;
    widthB: number;
    dirA: Point;
    dirB: Point;
};

export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

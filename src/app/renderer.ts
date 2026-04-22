import { BUILDING_COLORS, ROAD_STYLES } from "../constants";
import {
    lanePixels,
    normalizeRect,
    offsetPolyline,
    sampleQuadraticCurve,
} from "../geometry";
import type {
    Building,
    Camera,
    IntersectionInfo,
    Point,
    Road,
    RoadDrawMode,
    RoadType,
    Selection,
    Tool,
} from "../types";
import { clamp } from "../utils";

type RenderState = {
    camera: Camera;
    roads: Road[];
    buildings: Building[];
    selection: Selection;
    intersections: IntersectionInfo[];
    tool: Tool;
    roadDrawMode: RoadDrawMode;
    currentRoadPoints: Point[];
    roadPreviewPoint: Point | null;
    curveAnchorPoint: Point | null;
    buildingDragStart: Point | null;
    buildingDragCurrent: Point | null;
    roadTypeValue: RoadType;
    roadLanesValue: string;
    currentRoadBidirectionality: boolean;
};

export function renderScene(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: RenderState,
    screenToWorld: (screenX: number, screenY: number) => Point,
) {
    ctx.clearRect(0, 0, width, height);
    drawTerrain(ctx, width, height);

    ctx.save();
    applyCamera(ctx, state.camera, width, height);

    drawGrid(ctx, width, height, state.camera.zoom, screenToWorld);
    drawRoads(ctx, state.roads, state.selection);
    drawBuildings(ctx, state.buildings, state.selection, state.camera.zoom);
    drawIntersections(ctx, state.intersections);
    drawRoadPreview(ctx, state);
    drawBuildingPreview(
        ctx,
        state.buildingDragStart,
        state.buildingDragCurrent,
        state.camera.zoom,
    );

    ctx.restore();
}

function drawTerrain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#9dbc84");
    gradient.addColorStop(1, "#7f9f71");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.09;
    for (let i = 0; i < 22; i += 1) {
        const x = (i * 151) % width;
        const y = (i * 97) % height;
        ctx.beginPath();
        ctx.ellipse(x, y, 120, 45, 0.5, 0, Math.PI * 2);
        ctx.fillStyle = "#d8e6c4";
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function applyCamera(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
) {
    ctx.translate(viewportWidth * 0.5, viewportHeight * 0.5);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
}

function drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cameraZoom: number,
    screenToWorld: (screenX: number, screenY: number) => Point,
) {
    const worldTopLeft = screenToWorld(0, 0);
    const worldBottomRight = screenToWorld(width, height);
    const spacing = 80;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1 / cameraZoom;

    const startX = Math.floor(worldTopLeft.x / spacing) * spacing;
    const endX = Math.ceil(worldBottomRight.x / spacing) * spacing;
    const startY = Math.floor(worldTopLeft.y / spacing) * spacing;
    const endY = Math.ceil(worldBottomRight.y / spacing) * spacing;

    for (let x = startX; x <= endX; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }

    for (let y = startY; y <= endY; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawRoads(
    ctx: CanvasRenderingContext2D,
    roads: Road[],
    selection: Selection,
) {
    for (const road of roads) {
        if (road.points.length < 2) {
            continue;
        }

        const style = ROAD_STYLES[road.type];
        const width = lanePixels(road);

        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.strokeStyle = style.edge;
        ctx.lineWidth = width + 3;
        drawPolyline(ctx, road.points);

        ctx.strokeStyle = style.color;
        ctx.lineWidth = width;
        drawPolyline(ctx, road.points);

        const selected = selection.kind === "road" && selection.id === road.id;
        if (selected) {
            ctx.strokeStyle = "#ffd36c";
            ctx.lineWidth = width + 6;
            ctx.globalAlpha = 0.45;
            drawPolyline(ctx, road.points);
            ctx.globalAlpha = 1;
        }

        drawLaneMarks(ctx, road, width);
    }
}

function drawLaneMarks(
    ctx: CanvasRenderingContext2D,
    road: Road,
    width: number,
) {
    if (road.lanes <= 1) {
        return;
    }
    ctx.strokeStyle = "rgba(250, 250, 250, 0.75)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 7]);

    for (let lane = 1; lane < road.lanes; lane += 1) {
        const offset = -width * 0.5 + (width / road.lanes) * lane;
        const shifted = offsetPolyline(road.points, offset);
        if (shifted.length > 1) {
            drawPolyline(ctx, shifted);
        }
    }

    ctx.setLineDash([]);
}

function drawBuildings(
    ctx: CanvasRenderingContext2D,
    buildings: Building[],
    selection: Selection,
    cameraZoom: number,
) {
    for (const building of buildings) {
        const selected =
            selection.kind === "building" && selection.id === building.id;

        ctx.fillStyle = BUILDING_COLORS[building.type];
        ctx.fillRect(building.x, building.y, building.width, building.height);

        ctx.lineWidth = selected ? 2.5 / cameraZoom : 1.2 / cameraZoom;
        ctx.strokeStyle = selected ? "#ffd36c" : "rgba(40, 36, 30, 0.5)";
        ctx.strokeRect(building.x, building.y, building.width, building.height);

        if (building.source === "auto") {
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.setLineDash([4 / cameraZoom, 3 / cameraZoom]);
            ctx.strokeRect(
                building.x,
                building.y,
                building.width,
                building.height,
            );
            ctx.setLineDash([]);
        }
    }
}

function drawRoadPreview(ctx: CanvasRenderingContext2D, state: RenderState) {
    if (state.tool !== "road" || state.currentRoadPoints.length === 0) {
        return;
    }

    const _lanes = clamp(parseInt(state.roadLanesValue, 10) || 1, 1, 8);
    const ghostRoad: Road = {
        id: "preview",
        type: state.roadTypeValue,
        lanes: _lanes,
        points: [],
        bidirectional: state.currentRoadBidirectionality

    };

    const preview = [...state.currentRoadPoints];
    if (
        state.roadDrawMode === "curve" &&
        state.curveAnchorPoint &&
        state.roadPreviewPoint
    ) {
        const start =
            state.currentRoadPoints[state.currentRoadPoints.length - 1];
        const curveGhost = sampleQuadraticCurve(
            start,
            state.curveAnchorPoint,
            state.roadPreviewPoint,
            24,
        );
        preview.push(...curveGhost.slice(1));
    } else if (state.roadPreviewPoint) {
        preview.push(state.roadPreviewPoint);
    }

    ghostRoad.points = preview;
    const ghostWidth = lanePixels(ghostRoad);

    ctx.strokeStyle = "rgba(255, 233, 180, 0.35)";
    ctx.lineWidth = ghostWidth + 4;
    drawPolyline(ctx, preview);

    ctx.strokeStyle = "rgba(255, 204, 107, 0.95)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    drawPolyline(ctx, preview);
    ctx.setLineDash([]);

    for (const point of state.currentRoadPoints) {
        ctx.beginPath();
        ctx.fillStyle = "#ffe6b2";
        ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
    }

    if (state.curveAnchorPoint) {
        ctx.beginPath();
        ctx.fillStyle = "#ff8a4e";
        ctx.arc(
            state.curveAnchorPoint.x,
            state.curveAnchorPoint.y,
            4,
            0,
            Math.PI * 2,
        );
        ctx.fill();
    }

    if (state.roadPreviewPoint) {
        ctx.beginPath();
        ctx.strokeStyle = "#fff2ce";
        ctx.lineWidth = 1.5;
        ctx.arc(
            state.roadPreviewPoint.x,
            state.roadPreviewPoint.y,
            5,
            0,
            Math.PI * 2,
        );
        ctx.stroke();
    }
}

function drawIntersections(
    ctx: CanvasRenderingContext2D,
    intersections: IntersectionInfo[],
) {
    for (const info of intersections) {
        const drawDecal = (dir: Point, width: number) => {
            const len = Math.max(16, width * 1.2);
            const a: Point = {
                x: info.point.x - dir.x * len * 0.5,
                y: info.point.y - dir.y * len * 0.5,
            };
            const b: Point = {
                x: info.point.x + dir.x * len * 0.5,
                y: info.point.y + dir.y * len * 0.5,
            };

            ctx.lineCap = "round";
            ctx.strokeStyle = "rgba(245, 247, 240, 0.82)";
            ctx.lineWidth = Math.max(2, width * 0.16);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        };

        drawDecal(info.dirA, info.widthA);
        drawDecal(info.dirB, info.widthB);

        ctx.beginPath();
        ctx.fillStyle = "rgba(255, 210, 136, 0.9)";
        ctx.arc(info.point.x, info.point.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBuildingPreview(
    ctx: CanvasRenderingContext2D,
    buildingDragStart: Point | null,
    buildingDragCurrent: Point | null,
    cameraZoom: number,
) {
    if (!buildingDragStart || !buildingDragCurrent) {
        return;
    }
    const rect = normalizeRect(buildingDragStart, buildingDragCurrent);
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = "rgba(255, 240, 199, 0.95)";
    ctx.lineWidth = 2 / cameraZoom;
    ctx.setLineDash([5 / cameraZoom, 3 / cameraZoom]);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.setLineDash([]);
}

function drawPolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
    if (points.length < 2) {
        return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
}

import { BUILDING_COLORS, ROAD_STYLES } from "./constants";
import { must, must2dContext } from "./dom";
import {
  dedupeConsecutivePoints,
  lanePixels,
  normalize,
  normalizeRect,
  offsetPolyline,
  pointToSegmentDistance,
  samePoint,
  sampleQuadraticCurve,
  segmentIntersectionWithParameters,
  segmentIntersectsRect
} from "./geometry";
import { isValidProject } from "./project";
import { APP_TEMPLATE } from "./template";
import type {
  Building,
  BuildingType,
  Camera,
  IntersectionInfo,
  MapProject,
  Point,
  Rect,
  Road,
  RoadDrawMode,
  RoadType,
  Selection,
  Tool
} from "./types";
import { clamp, nextId } from "./utils";

export class MapPainterApp {
  private readonly app: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private readonly statusNode: HTMLParagraphElement;
  private readonly roadTypeInput: HTMLSelectElement;
  private readonly roadDrawModeInput: HTMLSelectElement;
  private readonly roadLanesInput: HTMLInputElement;
  private readonly buildingTypeInput: HTMLSelectElement;
  private readonly selectedRoadTypeInput: HTMLSelectElement;
  private readonly selectedRoadLanesInput: HTMLInputElement;
  private readonly pauseToggleButton: HTMLButtonElement;
  private readonly pauseResumeButton: HTMLButtonElement;
  private readonly pauseMenu: HTMLDivElement;
  private readonly buildCursor: HTMLDivElement;
  private readonly settingsBar: HTMLDivElement;

  private tool: Tool = "select";
  private roadDrawMode: RoadDrawMode = "straight";
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private roads: Road[] = [];
  private buildings: Building[] = [];
  private selection: Selection = { kind: "none" };
  private currentRoadPoints: Point[] = [];
  private roadPreviewPoint: Point | null = null;
  private curveAnchorPoint: Point | null = null;
  private buildingDragStart: Point | null = null;
  private buildingDragCurrent: Point | null = null;

  private isPanning = false;
  private panStartScreen: Point | null = null;
  private panStartCamera: Camera | null = null;
  private pointerDown = false;
  private renderPending = false;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private isPaused = false;
  private intersectionsCache: IntersectionInfo[] = [];
  private cursorVisible = false;

  constructor(rootSelector = "#app") {
    this.app = must<HTMLDivElement>(rootSelector);
    this.app.innerHTML = APP_TEMPLATE;

    this.canvas = must<HTMLCanvasElement>("#map-canvas");
    this.ctx = must2dContext(this.canvas);

    this.statusNode = must<HTMLParagraphElement>("#status");
    this.roadTypeInput = must<HTMLSelectElement>("#road-type");
    this.roadDrawModeInput = must<HTMLSelectElement>("#road-draw-mode");
    this.roadLanesInput = must<HTMLInputElement>("#road-lanes");
    this.buildingTypeInput = must<HTMLSelectElement>("#building-type");
    this.selectedRoadTypeInput = must<HTMLSelectElement>("#selected-road-type");
    this.selectedRoadLanesInput = must<HTMLInputElement>("#selected-road-lanes");
    this.pauseToggleButton = must<HTMLButtonElement>("#pause-toggle");
    this.pauseResumeButton = must<HTMLButtonElement>("#pause-resume");
    this.pauseMenu = must<HTMLDivElement>("#pause-menu");
    this.buildCursor = must<HTMLDivElement>("#build-cursor");
    this.settingsBar = must<HTMLDivElement>(".settings-bar");

    this.bindUi();
    this.setupCanvasResize();
    this.setActiveToolButton();
    this.updateToolbarVisibility();
    this.updateCursorStyle();
    this.updateStatus("Ready. Select a tool to begin.");
    this.requestRender();
  }

  private bindUi() {
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        this.tool = button.dataset.tool as Tool;
        if (this.tool !== "road") {
          this.currentRoadPoints = [];
          this.roadPreviewPoint = null;
          this.curveAnchorPoint = null;
        }
        this.setActiveToolButton();
        this.updateToolbarVisibility();
        this.updateCursorStyle();
        this.updateStatus(`Tool: ${this.tool}`);
        this.requestRender();
      });
    });

    this.pauseToggleButton.addEventListener("click", () => {
      this.setPaused(!this.isPaused);
    });

    this.pauseResumeButton.addEventListener("click", () => {
      this.setPaused(false);
    });

    this.roadDrawModeInput.addEventListener("change", () => {
      this.roadDrawMode = this.roadDrawModeInput.value as RoadDrawMode;
      this.currentRoadPoints = [];
      this.curveAnchorPoint = null;
      this.roadPreviewPoint = null;
      this.updateCursorStyle();
      this.updateStatus(`Road mode: ${this.roadDrawMode}`);
      this.requestRender();
    });

    must<HTMLButtonElement>("#finish-road").addEventListener("click", () => {
      this.commitRoad();
    });

    must<HTMLButtonElement>("#cancel-road").addEventListener("click", () => {
      this.currentRoadPoints = [];
      this.roadPreviewPoint = null;
      this.curveAnchorPoint = null;
      this.updateStatus("Canceled current road.");
      this.requestRender();
    });

    must<HTMLButtonElement>("#delete-selection").addEventListener("click", () => {
      if (this.selection.kind === "road") {
        const roadId = this.selection.id;
        this.roads = this.roads.filter((road) => road.id !== roadId);
        this.selection = { kind: "none" };
        this.refreshIntersections();
        this.updateStatus("Deleted selected road.");
      } else if (this.selection.kind === "building") {
        const buildingId = this.selection.id;
        this.buildings = this.buildings.filter((building) => building.id !== buildingId);
        this.selection = { kind: "none" };
        this.updateStatus("Deleted selected building.");
      }
      this.requestRender();
    });

    this.selectedRoadTypeInput.addEventListener("change", () => {
      if (this.selection.kind !== "road") {
        return;
      }
      const selectedRoadId = this.selection.id;
      const selectedRoad = this.roads.find((road) => road.id === selectedRoadId);
      if (!selectedRoad) {
        return;
      }
      selectedRoad.type = this.selectedRoadTypeInput.value as RoadType;
      const removed = this.pruneConflictingBuildings();
      this.refreshIntersections();
      if (removed > 0) {
        this.updateStatus(`Updated road type and removed ${removed} conflicting building(s).`);
      }
      this.requestRender();
    });

    this.selectedRoadLanesInput.addEventListener("change", () => {
      if (this.selection.kind !== "road") {
        return;
      }
      const selectedRoadId = this.selection.id;
      const selectedRoad = this.roads.find((road) => road.id === selectedRoadId);
      if (!selectedRoad) {
        return;
      }
      selectedRoad.lanes = clamp(parseInt(this.selectedRoadLanesInput.value, 10) || 1, 1, 8);
      this.selectedRoadLanesInput.value = String(selectedRoad.lanes);
      const removed = this.pruneConflictingBuildings();
      this.refreshIntersections();
      if (removed > 0) {
        this.updateStatus(`Updated lane count and removed ${removed} conflicting building(s).`);
      }
      this.requestRender();
    });

    must<HTMLButtonElement>("#generate-buildings").addEventListener("click", () => {
      const created = this.generateAutoBuildings();
      this.updateStatus(`Generated ${created} auto buildings.`);
      this.requestRender();
    });

    must<HTMLButtonElement>("#clear-auto").addEventListener("click", () => {
      const before = this.buildings.length;
      this.buildings = this.buildings.filter((b) => b.source === "manual");
      this.updateStatus(`Removed ${before - this.buildings.length} auto buildings.`);
      this.requestRender();
    });

    must<HTMLButtonElement>("#save-json").addEventListener("click", () => {
      this.saveProject();
    });

    must<HTMLInputElement>("#load-json").addEventListener("change", async (event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) {
        return;
      }
      const raw = await file.text();
      try {
        const parsed = JSON.parse(raw) as MapProject;
        if (!isValidProject(parsed)) {
          throw new Error("Invalid map schema.");
        }
        this.roads = parsed.roads;
        this.buildings = parsed.buildings;
        this.splitRoadNetworkAtIntersections();
        this.refreshIntersections();
        this.selection = { kind: "none" };
        this.currentRoadPoints = [];
        this.roadPreviewPoint = null;
        const removed = this.pruneConflictingBuildings();
        this.updateStatus(
          `Loaded ${this.roads.length} roads and ${this.buildings.length} buildings.${
            removed > 0 ? ` Removed ${removed} conflicting building(s).` : ""
          }`
        );
        this.requestRender();
      } catch (error) {
        this.updateStatus(`Load failed: ${(error as Error).message}`);
      } finally {
        target.value = "";
      }
    });

    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerleave", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerenter", () => {
      this.cursorVisible = true;
      this.updateCursorStyle();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.cursorVisible = false;
      this.updateCursorStyle();
    });
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.canvas.addEventListener("dblclick", () => this.commitRoad());
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "p") {
        this.setPaused(!this.isPaused);
        return;
      }

      if (this.isPaused) {
        if (event.key === "Escape") {
          this.setPaused(false);
        }
        return;
      }

      if (event.key === "Enter" && this.tool === "road") {
        this.commitRoad();
      }
      if (event.key === "Escape") {
        this.currentRoadPoints = [];
        this.roadPreviewPoint = null;
        this.buildingDragStart = null;
        this.buildingDragCurrent = null;
        this.requestRender();
        this.updateStatus("Canceled active gesture.");
      }
      if (event.key.toLowerCase() === "delete" || event.key.toLowerCase() === "backspace") {
        if (this.selection.kind === "road") {
          const selectedRoadId = this.selection.id;
          this.roads = this.roads.filter((road) => road.id !== selectedRoadId);
          this.selection = { kind: "none" };
          this.refreshIntersections();
          this.requestRender();
        }
        if (this.selection.kind === "building") {
          const selectedBuildingId = this.selection.id;
          this.buildings = this.buildings.filter((building) => building.id !== selectedBuildingId);
          this.selection = { kind: "none" };
          this.requestRender();
        }
      }
    });
  }

  private onPointerDown(event: PointerEvent) {
    if (this.isPaused) {
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
    }

    this.pointerDown = true;
    this.canvas.setPointerCapture(event.pointerId);
    const world = this.screenToWorld(event.offsetX, event.offsetY);

    if (event.button === 1) {
      this.isPanning = true;
      this.panStartScreen = { x: event.clientX, y: event.clientY };
      this.panStartCamera = { ...this.camera };
      this.updateCursorStyle();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (this.tool === "road") {
      this.handleRoadClick(world);
      this.requestRender();
      return;
    }

    if (this.tool === "building") {
      this.buildingDragStart = world;
      this.buildingDragCurrent = world;
      this.requestRender();
      return;
    }

    if (this.tool === "select") {
      this.selectAt(world);
    }
  }

  private onPointerMove(event: PointerEvent) {
    this.cursorVisible = true;
    this.updateCursorPosition(event.offsetX, event.offsetY);
    this.updateCursorStyle();

    const world = this.screenToWorld(event.offsetX, event.offsetY);

    if (this.isPaused) {
      return;
    }

    if (this.isPanning && this.panStartScreen && this.panStartCamera) {
      const dx = event.clientX - this.panStartScreen.x;
      const dy = event.clientY - this.panStartScreen.y;
      this.camera.x = this.panStartCamera.x - dx / this.camera.zoom;
      this.camera.y = this.panStartCamera.y - dy / this.camera.zoom;
      this.requestRender();
      return;
    }

    if (this.tool === "road") {
      this.roadPreviewPoint = world;
      this.requestRender();
    }

    if (this.tool === "building" && this.buildingDragStart && this.pointerDown) {
      this.buildingDragCurrent = world;
      this.requestRender();
    }
  }

  private onPointerUp(event: PointerEvent) {
    if (this.isPaused) {
      return;
    }

    this.pointerDown = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.updateCursorStyle();
      return;
    }

    if (this.tool === "building" && this.buildingDragStart && this.buildingDragCurrent) {
      const rect = normalizeRect(this.buildingDragStart, this.buildingDragCurrent);
      if (rect.width > 3 && rect.height > 3) {
        this.buildings.push({
          id: nextId("building"),
          source: "manual",
          type: this.buildingTypeInput.value as BuildingType,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        });
        const removed = this.pruneConflictingBuildings();
        this.updateStatus(
          removed > 0
            ? `Placed building, then removed ${removed} conflicting building(s).`
            : "Placed manual building."
        );
      }
      this.buildingDragStart = null;
      this.buildingDragCurrent = null;
      this.requestRender();
    }
  }

  private onWheel(event: WheelEvent) {
    if (this.isPaused) {
      return;
    }

    event.preventDefault();

    const worldBefore = this.screenToWorld(event.offsetX, event.offsetY);
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.1 : 0.9;
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.25, 4);
    const worldAfter = this.screenToWorld(event.offsetX, event.offsetY);

    this.camera.x += worldBefore.x - worldAfter.x;
    this.camera.y += worldBefore.y - worldAfter.y;
    this.requestRender();
  }

  private commitRoad() {
    if (this.currentRoadPoints.length < 2) {
      return;
    }

    const lanes = clamp(parseInt(this.roadLanesInput.value, 10) || 1, 1, 8);
    const road: Road = {
      id: nextId("road"),
      type: this.roadTypeInput.value as RoadType,
      lanes,
      points: [...this.currentRoadPoints]
    };
    this.roads.push(road);
    this.splitRoadNetworkAtIntersections();
    const removed = this.pruneConflictingBuildings();
    this.refreshIntersections();
    this.currentRoadPoints = [];
    this.roadPreviewPoint = null;
    this.curveAnchorPoint = null;
    this.updateStatus(
      `Created ${road.type} road with ${road.lanes} lane(s). ${this.intersectionsCache.length} intersection(s) detected.${
        removed > 0 ? ` Removed ${removed} conflicting building(s).` : ""
      }`
    );
    this.requestRender();
  }

  private handleRoadClick(world: Point) {
    if (this.roadDrawMode === "straight") {
      this.currentRoadPoints.push(world);
      this.roadPreviewPoint = world;
      this.updateStatus(
        `Road points: ${this.currentRoadPoints.length}. Double-click or Finish to commit.`
      );
      return;
    }

    if (this.currentRoadPoints.length === 0) {
      this.currentRoadPoints.push(world);
      this.roadPreviewPoint = world;
      this.curveAnchorPoint = null;
      this.updateStatus("Curve mode: click anchor point.");
      return;
    }

    if (!this.curveAnchorPoint) {
      this.curveAnchorPoint = world;
      this.updateStatus("Curve mode: click end point.");
      return;
    }

    const start = this.currentRoadPoints[this.currentRoadPoints.length - 1];
    const sampled = sampleQuadraticCurve(start, this.curveAnchorPoint, world, 20);
    sampled.shift();
    this.currentRoadPoints.push(...sampled);
    this.roadPreviewPoint = world;
    this.curveAnchorPoint = null;
    this.updateStatus(`Curve added. Road points: ${this.currentRoadPoints.length}.`);
  }

  private selectAt(world: Point) {
    const building = this.findBuildingAt(world);
    if (building) {
      this.selection = { kind: "building", id: building.id };
      this.updateStatus(`Selected building (${building.type}, ${building.source}).`);
      this.requestRender();
      return;
    }

    const road = this.findRoadAt(world);
    if (road) {
      this.selection = { kind: "road", id: road.id };
      this.selectedRoadTypeInput.value = road.type;
      this.selectedRoadLanesInput.value = String(road.lanes);
      this.updateStatus(`Selected ${road.type} road (${road.lanes} lanes).`);
      this.requestRender();
      return;
    }

    this.selection = { kind: "none" };
    this.updateStatus("Selection cleared.");
    this.requestRender();
  }

  private findBuildingAt(point: Point): Building | null {
    for (let i = this.buildings.length - 1; i >= 0; i -= 1) {
      const b = this.buildings[i];
      if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
        return b;
      }
    }
    return null;
  }

  private findRoadAt(point: Point): Road | null {
    const tolerance = 10 / this.camera.zoom;
    for (let i = this.roads.length - 1; i >= 0; i -= 1) {
      const road = this.roads[i];
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

  private generateAutoBuildings(): number {
    this.buildings = this.buildings.filter((b) => b.source === "manual");
    let created = 0;

    for (const road of this.roads) {
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
              type: this.inferBuildingType(road.type, n),
              x: centerX - width * 0.5,
              y: centerY - depth * 0.5,
              width,
              height: depth
            };

            if (!this.collidesBuilding(candidate) && !this.collidesWithRoadNetwork(candidate)) {
              this.buildings.push(candidate);
              created += 1;
            }
          }
        }
      }
    }

    return created;
  }

  private inferBuildingType(roadType: RoadType, index: number): BuildingType {
    if (roadType === "highway") {
      return index % 2 === 0 ? "industrial" : "commercial";
    }
    if (roadType === "avenue") {
      return index % 3 === 0 ? "commercial" : "residential";
    }
    return index % 5 === 0 ? "commercial" : "residential";
  }

  private collidesBuilding(candidate: Building): boolean {
    for (const existing of this.buildings) {
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

  private collidesWithRoadNetwork(candidate: Building): boolean {
    for (const road of this.roads) {
      if (this.buildingCollidesWithRoad(candidate, road)) {
        return true;
      }
    }
    return false;
  }

  private pruneConflictingBuildings(): number {
    const before = this.buildings.length;
    this.buildings = this.buildings.filter((building) => !this.collidesWithRoadNetwork(building));
    return before - this.buildings.length;
  }

  private buildingCollidesWithRoad(building: Building, road: Road): boolean {
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

  private calculateIntersectionsDetailed(): IntersectionInfo[] {
    const intersections: IntersectionInfo[] = [];

    for (let i = 0; i < this.roads.length; i += 1) {
      const aRoad = this.roads[i];
      for (let j = i + 1; j < this.roads.length; j += 1) {
        const bRoad = this.roads[j];

        if (aRoad.type === "highway" || bRoad.type === "highway") {
          continue;
        }

        for (let sa = 1; sa < aRoad.points.length; sa += 1) {
          const a1 = aRoad.points[sa - 1];
          const a2 = aRoad.points[sa];
          for (let sb = 1; sb < bRoad.points.length; sb += 1) {
            const b1 = bRoad.points[sb - 1];
            const b2 = bRoad.points[sb];
            const hit = segmentIntersectionWithParameters(a1, a2, b1, b2);
            if (!hit) {
              continue;
            }

            const duplicate = intersections.some(
              (info) => Math.hypot(info.point.x - hit.point.x, info.point.y - hit.point.y) < 2
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
              dirB: normalize({ x: b2.x - b1.x, y: b2.y - b1.y })
            });
          }
        }
      }
    }

    return intersections;
  }

  private splitRoadNetworkAtIntersections() {
    const epsilon = 0.001;
    const splitMap = new Map<string, Map<number, Array<{ t: number; point: Point }>>>();

    for (const road of this.roads) {
      splitMap.set(road.id, new Map());
    }

    for (let i = 0; i < this.roads.length; i += 1) {
      const aRoad = this.roads[i];
      for (let j = i + 1; j < this.roads.length; j += 1) {
        const bRoad = this.roads[j];
        if (aRoad.type === "highway" || bRoad.type === "highway") {
          continue;
        }

        for (let sa = 1; sa < aRoad.points.length; sa += 1) {
          const a1 = aRoad.points[sa - 1];
          const a2 = aRoad.points[sa];
          for (let sb = 1; sb < bRoad.points.length; sb += 1) {
            const b1 = bRoad.points[sb - 1];
            const b2 = bRoad.points[sb];
            const hit = segmentIntersectionWithParameters(a1, a2, b1, b2);
            if (!hit) {
              continue;
            }

            if (hit.tA > epsilon && hit.tA < 1 - epsilon) {
              this.addSplitPoint(splitMap, aRoad.id, sa, hit.tA, hit.point);
            }
            if (hit.tB > epsilon && hit.tB < 1 - epsilon) {
              this.addSplitPoint(splitMap, bRoad.id, sb, hit.tB, hit.point);
            }
          }
        }
      }
    }

    const rebuilt: Road[] = [];
    for (const road of this.roads) {
      const bySegment = splitMap.get(road.id);
      if (!bySegment || bySegment.size === 0) {
        rebuilt.push(road);
        continue;
      }

      let current: Point[] = [road.points[0]];
      for (let seg = 1; seg < road.points.length; seg += 1) {
        const segmentEnd = road.points[seg];
        const splits = [...(bySegment.get(seg) ?? [])].sort((a, b) => a.t - b.t);

        for (const split of splits) {
          if (!samePoint(current[current.length - 1], split.point)) {
            current.push(split.point);
          }
          if (current.length >= 2) {
            rebuilt.push({ ...road, id: nextId("road"), points: dedupeConsecutivePoints(current) });
          }
          current = [split.point];
        }

        if (!samePoint(current[current.length - 1], segmentEnd)) {
          current.push(segmentEnd);
        }
      }

      if (current.length >= 2) {
        rebuilt.push({ ...road, id: nextId("road"), points: dedupeConsecutivePoints(current) });
      }
    }

    this.roads = rebuilt.filter((road) => road.points.length >= 2);
  }

  private addSplitPoint(
    splitMap: Map<string, Map<number, Array<{ t: number; point: Point }>>>,
    roadId: string,
    segmentIndex: number,
    t: number,
    point: Point
  ) {
    const roadMap = splitMap.get(roadId);
    if (!roadMap) {
      return;
    }
    const list = roadMap.get(segmentIndex) ?? [];
    const duplicate = list.some(
      (entry) => Math.hypot(entry.point.x - point.x, entry.point.y - point.y) < 1.5
    );
    if (!duplicate) {
      list.push({ t, point });
    }
    roadMap.set(segmentIndex, list);
  }

  private saveProject() {
    const project: MapProject = {
      version: 1,
      roads: this.roads,
      buildings: this.buildings
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mappainter-project.json";
    link.click();
    URL.revokeObjectURL(url);
    this.updateStatus("Project saved to JSON file.");
  }

  private refreshIntersections() {
    this.intersectionsCache = this.calculateIntersectionsDetailed();
  }

  private setPaused(nextPaused: boolean) {
    this.isPaused = nextPaused;
    this.pauseMenu.hidden = !this.isPaused;
    this.pauseToggleButton.textContent = this.isPaused ? "Resume" : "Pause";
    if (this.isPaused) {
      this.isPanning = false;
      this.pointerDown = false;
    }
    this.updateCursorStyle();
  }

  private requestRender() {
    if (this.renderPending) {
      return;
    }
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.render();
    });
  }

  private render() {
    const width = this.viewportWidth;
    const height = this.viewportHeight;
    this.ctx.clearRect(0, 0, width, height);

    this.drawTerrain(width, height);

    this.ctx.save();
    this.applyCamera();

    this.drawGrid(width, height);
    this.drawRoads();
    this.drawBuildings();
    this.drawIntersections();
    this.drawRoadPreview();
    this.drawBuildingPreview();

    this.ctx.restore();
  }

  private drawTerrain(width: number, height: number) {
    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#9dbc84");
    gradient.addColorStop(1, "#7f9f71");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.globalAlpha = 0.09;
    for (let i = 0; i < 22; i += 1) {
      const x = (i * 151) % width;
      const y = (i * 97) % height;
      this.ctx.beginPath();
      this.ctx.ellipse(x, y, 120, 45, 0.5, 0, Math.PI * 2);
      this.ctx.fillStyle = "#d8e6c4";
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }

  private applyCamera() {
    this.ctx.translate(this.viewportWidth * 0.5, this.viewportHeight * 0.5);
    this.ctx.scale(this.camera.zoom, this.camera.zoom);
    this.ctx.translate(-this.camera.x, -this.camera.y);
  }

  private drawGrid(width: number, height: number) {
    const worldTopLeft = this.screenToWorld(0, 0);
    const worldBottomRight = this.screenToWorld(width, height);
    const spacing = 80;

    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    this.ctx.lineWidth = 1 / this.camera.zoom;

    const startX = Math.floor(worldTopLeft.x / spacing) * spacing;
    const endX = Math.ceil(worldBottomRight.x / spacing) * spacing;
    const startY = Math.floor(worldTopLeft.y / spacing) * spacing;
    const endY = Math.ceil(worldBottomRight.y / spacing) * spacing;

    for (let x = startX; x <= endX; x += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, startY);
      this.ctx.lineTo(x, endY);
      this.ctx.stroke();
    }

    for (let y = startY; y <= endY; y += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(endX, y);
      this.ctx.stroke();
    }
  }

  private drawRoads() {
    for (const road of this.roads) {
      if (road.points.length < 2) {
        continue;
      }

      const style = ROAD_STYLES[road.type];
      const width = lanePixels(road);

      this.ctx.lineJoin = "round";
      this.ctx.lineCap = "round";

      this.ctx.strokeStyle = style.edge;
      this.ctx.lineWidth = width + 3;
      this.drawPolyline(road.points);

      this.ctx.strokeStyle = style.color;
      this.ctx.lineWidth = width;
      this.drawPolyline(road.points);

      const selected = this.selection.kind === "road" && this.selection.id === road.id;
      if (selected) {
        this.ctx.strokeStyle = "#ffd36c";
        this.ctx.lineWidth = width + 6;
        this.ctx.globalAlpha = 0.45;
        this.drawPolyline(road.points);
        this.ctx.globalAlpha = 1;
      }

      this.drawLaneMarks(road, width);
    }
  }

  private drawLaneMarks(road: Road, width: number) {
    if (road.lanes <= 1) {
      return;
    }
    this.ctx.strokeStyle = "rgba(250, 250, 250, 0.75)";
    this.ctx.lineWidth = 1.4;
    this.ctx.setLineDash([7, 7]);

    for (let lane = 1; lane < road.lanes; lane += 1) {
      const offset = -width * 0.5 + (width / road.lanes) * lane;
      const shifted = offsetPolyline(road.points, offset);
      if (shifted.length > 1) {
        this.drawPolyline(shifted);
      }
    }

    this.ctx.setLineDash([]);
  }

  private drawBuildings() {
    for (const building of this.buildings) {
      const selected = this.selection.kind === "building" && this.selection.id === building.id;

      this.ctx.fillStyle = BUILDING_COLORS[building.type];
      this.ctx.fillRect(building.x, building.y, building.width, building.height);

      this.ctx.lineWidth = selected ? 2.5 / this.camera.zoom : 1.2 / this.camera.zoom;
      this.ctx.strokeStyle = selected ? "#ffd36c" : "rgba(40, 36, 30, 0.5)";
      this.ctx.strokeRect(building.x, building.y, building.width, building.height);

      if (building.source === "auto") {
        this.ctx.strokeStyle = "rgba(255,255,255,0.45)";
        this.ctx.setLineDash([4 / this.camera.zoom, 3 / this.camera.zoom]);
        this.ctx.strokeRect(building.x, building.y, building.width, building.height);
        this.ctx.setLineDash([]);
      }
    }
  }

  private drawRoadPreview() {
    if (this.tool !== "road" || this.currentRoadPoints.length === 0) {
      return;
    }

    const lanes = clamp(parseInt(this.roadLanesInput.value, 10) || 1, 1, 8);
    const ghostRoad: Road = {
      id: "preview",
      type: this.roadTypeInput.value as RoadType,
      lanes,
      points: []
    };

    const preview = [...this.currentRoadPoints];
    if (this.roadDrawMode === "curve" && this.curveAnchorPoint && this.roadPreviewPoint) {
      const start = this.currentRoadPoints[this.currentRoadPoints.length - 1];
      const curveGhost = sampleQuadraticCurve(start, this.curveAnchorPoint, this.roadPreviewPoint, 24);
      preview.push(...curveGhost.slice(1));
    } else if (this.roadPreviewPoint) {
      preview.push(this.roadPreviewPoint);
    }

    ghostRoad.points = preview;
    const ghostWidth = lanePixels(ghostRoad);

    this.ctx.strokeStyle = "rgba(255, 233, 180, 0.35)";
    this.ctx.lineWidth = ghostWidth + 4;
    this.drawPolyline(preview);

    this.ctx.strokeStyle = "rgba(255, 204, 107, 0.95)";
    this.ctx.lineWidth = 4;
    this.ctx.setLineDash([10, 8]);
    this.drawPolyline(preview);
    this.ctx.setLineDash([]);

    for (const point of this.currentRoadPoints) {
      this.ctx.beginPath();
      this.ctx.fillStyle = "#ffe6b2";
      this.ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
      this.ctx.fill();
    }

    if (this.curveAnchorPoint) {
      this.ctx.beginPath();
      this.ctx.fillStyle = "#ff8a4e";
      this.ctx.arc(this.curveAnchorPoint.x, this.curveAnchorPoint.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    if (this.roadPreviewPoint) {
      this.ctx.beginPath();
      this.ctx.strokeStyle = "#fff2ce";
      this.ctx.lineWidth = 1.5;
      this.ctx.arc(this.roadPreviewPoint.x, this.roadPreviewPoint.y, 5, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  private drawIntersections() {
    for (const info of this.intersectionsCache) {
      const drawDecal = (dir: Point, width: number) => {
        const len = Math.max(16, width * 1.2);
        const a: Point = {
          x: info.point.x - dir.x * len * 0.5,
          y: info.point.y - dir.y * len * 0.5
        };
        const b: Point = {
          x: info.point.x + dir.x * len * 0.5,
          y: info.point.y + dir.y * len * 0.5
        };

        this.ctx.lineCap = "round";
        this.ctx.strokeStyle = "rgba(245, 247, 240, 0.82)";
        this.ctx.lineWidth = Math.max(2, width * 0.16);
        this.ctx.beginPath();
        this.ctx.moveTo(a.x, a.y);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
      };

      drawDecal(info.dirA, info.widthA);
      drawDecal(info.dirB, info.widthB);

      this.ctx.beginPath();
      this.ctx.fillStyle = "rgba(255, 210, 136, 0.9)";
      this.ctx.arc(info.point.x, info.point.y, 2.6, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawBuildingPreview() {
    if (!this.buildingDragStart || !this.buildingDragCurrent) {
      return;
    }
    const rect = normalizeRect(this.buildingDragStart, this.buildingDragCurrent);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.strokeStyle = "rgba(255, 240, 199, 0.95)";
    this.ctx.lineWidth = 2 / this.camera.zoom;
    this.ctx.setLineDash([5 / this.camera.zoom, 3 / this.camera.zoom]);
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.setLineDash([]);
  }

  private drawPolyline(points: Point[]) {
    if (points.length < 2) {
      return;
    }
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.stroke();
  }

  private screenToWorld(screenX: number, screenY: number): Point {
    const centeredX = screenX - this.viewportWidth * 0.5;
    const centeredY = screenY - this.viewportHeight * 0.5;
    return {
      x: centeredX / this.camera.zoom + this.camera.x,
      y: centeredY / this.camera.zoom + this.camera.y
    };
  }

  private setActiveToolButton() {
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === this.tool);
    });
  }

  private updateToolbarVisibility() {
    let anyVisible = false;
    document.querySelectorAll<HTMLElement>(".toolbar-section").forEach((section) => {
      const scope = section.dataset.scope;
      if (!scope || scope === "all") {
        section.hidden = false;
        anyVisible = true;
        return;
      }
      section.hidden = scope !== this.tool;
      if (!section.hidden) {
        anyVisible = true;
      }
    });

    this.settingsBar.hidden = !anyVisible;
  }

  private updateCursorPosition(x: number, y: number) {
    this.buildCursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  private updateCursorStyle() {
    const classes = ["build-cursor"];
    if (this.isPaused) {
      classes.push("cursor-paused");
    } else if (this.isPanning) {
      classes.push("cursor-pan");
    } else if (this.tool === "road") {
      classes.push(this.roadDrawMode === "curve" ? "cursor-road-curve" : "cursor-road");
    } else if (this.tool === "building") {
      classes.push("cursor-building");
    } else {
      classes.push("cursor-select");
    }
    if (!this.cursorVisible) {
      classes.push("hidden");
    }
    this.buildCursor.className = classes.join(" ");
  }

  private updateStatus(message: string) {
    this.statusNode.textContent = message;
  }

  private setupCanvasResize() {
    const resize = () => {
      const parent = this.canvas.parentElement;
      if (!parent) {
        return;
      }
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.viewportWidth = Math.max(1, rect.width);
      this.viewportHeight = Math.max(1, rect.height);
      this.canvas.width = Math.max(1, Math.floor(this.viewportWidth * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.viewportHeight * dpr));
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
      this.requestRender();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(this.canvas.parentElement ?? this.canvas);
    resize();
  }
}

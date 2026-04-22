import { must, must2dContext } from "./dom";
import {
  normalizeRect,
  sampleQuadraticCurve
} from "./geometry";
import {
  generateAutoBuildings as generateAutoBuildingsForRoads,
  pruneConflictingBuildings as pruneConflictingBuildingsForRoads
} from "./app/building-logic";
import { findBuildingAt as findBuildingAtPoint, findRoadAt as findRoadAtPoint } from "./app/hit-testing";
import {
  calculateIntersectionsDetailed as calculateRoadIntersections,
  splitRoadNetworkAtIntersections as splitRoadNetwork
} from "./app/road-network";
import { renderScene } from "./app/renderer";
import { isValidProject } from "./project";
import { APP_TEMPLATE } from "./template";
import type {
  Building,
  BuildingType,
  Camera,
  IntersectionInfo,
  MapProject,
  Point,
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
  private currentRoadBidirectionality: boolean = true; // TODO: Implement unidirectional roads

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

    const _lanes = clamp(parseInt(this.roadLanesInput.value, 10) || 1, 1, 8);
    const road: Road = {
      id: nextId("road"),
      type: this.roadTypeInput.value as RoadType,
      lanes: _lanes,
      points: [...this.currentRoadPoints],
      bidirectional: this.currentRoadBidirectionality

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
    return findBuildingAtPoint(point, this.buildings);
  }

  private findRoadAt(point: Point): Road | null {
    return findRoadAtPoint(point, this.roads, this.camera.zoom);
  }

  private generateAutoBuildings(): number {
    const generated = generateAutoBuildingsForRoads(this.roads, this.buildings);
    this.buildings = generated.buildings;
    return generated.created;
  }

  private pruneConflictingBuildings(): number {
    const result = pruneConflictingBuildingsForRoads(this.buildings, this.roads);
    this.buildings = result.buildings;
    return result.removed;
  }

  private splitRoadNetworkAtIntersections() {
    this.roads = splitRoadNetwork(this.roads);
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
    this.intersectionsCache = calculateRoadIntersections(this.roads);
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
    renderScene(
      this.ctx,
      this.viewportWidth,
      this.viewportHeight,
      {
        camera: this.camera,
        roads: this.roads,
        buildings: this.buildings,
        selection: this.selection,
        intersections: this.intersectionsCache,
        tool: this.tool,
        roadDrawMode: this.roadDrawMode,
        currentRoadPoints: this.currentRoadPoints,
        roadPreviewPoint: this.roadPreviewPoint,
        curveAnchorPoint: this.curveAnchorPoint,
        buildingDragStart: this.buildingDragStart,
        buildingDragCurrent: this.buildingDragCurrent,
        roadTypeValue: this.roadTypeInput.value as RoadType,
        roadLanesValue: this.roadLanesInput.value,
        currentRoadBidirectionality: this.currentRoadBidirectionality,
      },
      (screenX, screenY) => this.screenToWorld(screenX, screenY)
    );
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

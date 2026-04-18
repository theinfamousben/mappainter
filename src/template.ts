export const APP_TEMPLATE = `
  <div class="app-shell">
    <section class="canvas-wrap">
      <canvas id="map-canvas"></canvas>

      <div class="main-bar">
        <div class="brand">
          <h1>City Map Painter</h1>
          <p class="subtitle">Middle-click pan, wheel zoom</p>
        </div>
        <div class="tool-grid tool-grid-3 main-modes">
          <button data-tool="select">Select</button>
          <button data-tool="road">Road</button>
          <button data-tool="building">Building</button>
        </div>
        <button id="pause-toggle" class="pause-button">Pause</button>
      </div>

      <div class="settings-bar">
        <section class="group group-inline toolbar-section" data-scope="road">
          <label>
            Draw Mode
            <select id="road-draw-mode">
              <option value="straight">Straight</option>
              <option value="curve">Curve (start-anchor-end)</option>
            </select>
          </label>
          <label>
            Road
            <select id="road-type">
              <option value="street">Street</option>
              <option value="avenue">Avenue</option>
              <option value="highway">Highway</option>
            </select>
          </label>
          <label>
            Lanes
            <input id="road-lanes" type="number" min="1" max="8" value="2" />
          </label>
          <button id="finish-road" class="strong">Finish</button>
          <button id="cancel-road">Cancel</button>
        </section>

        <section class="group group-inline toolbar-section" data-scope="building">
          <label>
            Building
            <select id="building-type">
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </select>
          </label>
          <button id="generate-buildings" class="strong">Auto Along Roads</button>
          <button id="clear-auto">Clear Auto</button>
        </section>

        <section class="group group-inline toolbar-section" data-scope="select">
          <label>
            Selected Road
            <select id="selected-road-type">
              <option value="street">Street</option>
              <option value="avenue">Avenue</option>
              <option value="highway">Highway</option>
            </select>
          </label>
          <label>
            Selected Lanes
            <input id="selected-road-lanes" type="number" min="1" max="8" value="2" />
          </label>
          <button id="delete-selection">Delete Selected</button>
        </section>
      </div>

      <div id="pause-menu" class="pause-menu" hidden>
        <div class="pause-card">
          <h2>Paused</h2>
          <p>Project and session controls</p>
          <div class="pause-actions">
            <button id="save-json" class="strong">Save JSON</button>
            <label class="load-label">
              Load JSON
              <input id="load-json" type="file" accept="application/json" />
            </label>
            <button id="pause-resume">Resume</button>
          </div>
        </div>
      </div>

      <div id="build-cursor" class="build-cursor hidden"></div>
      <p id="status" class="status">Ready</p>
      <div class="legend">Road: click to add, double-click/Enter to finish</div>
    </section>
  </div>
`;

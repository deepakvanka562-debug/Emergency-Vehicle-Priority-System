/**
 * AI Smart Traffic and Emergency Vehicle Priority System
 * Core logic for grid simulation, vehicle movement, traffic signals, and AI routing.
 */

// Simulation Constants
const GRID_SIZE = 15;
const ROAD_ROWS = [3, 7, 11];
const ROAD_COLS = [3, 7, 11];

// Global State
let simulationInterval = null;
let isRunning = false;
let tickSpeed = 500; // ms per tick, adjusted by speed control
let densityRate = 0.05; // probability of car spawn per tick
let totalVehicles = 0;
let timeSaved = 0;
let nodesExplored = 0;
let signalsUpdated = 0;

// Grid Data
let grid = []; // 2D array of cells { isRoad, isIntersection, element, x, y }
let intersections = []; // { x, y, signalState (0=V-Green, 1=H-Green), element, overrideDir }
let vehicles = []; // Array of vehicle objects
let ambulance = null;

// UI Elements
const gridContainer = document.getElementById('simulation-grid');
const btnStart = document.getElementById('btn-start');
const btnAddAmbulance = document.getElementById('btn-add-ambulance');
const btnReset = document.getElementById('btn-reset');
const speedSelect = document.getElementById('sim-speed');
const densitySelect = document.getElementById('traffic-density');

// Initialization
function initGrid() {
    gridContainer.innerHTML = '';
    gridContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
    gridContainer.style.gridTemplateRows = `repeat(${GRID_SIZE}, 1fr)`;
    grid = [];
    intersections = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        let row = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const isRoadRow = ROAD_ROWS.includes(y);
            const isRoadCol = ROAD_COLS.includes(x);
            const isRoad = isRoadRow || isRoadCol;
            const isIntersection = isRoadRow && isRoadCol;

            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            if (isRoad) cell.classList.add('road');
            if (isIntersection) cell.classList.add('intersection');

            gridContainer.appendChild(cell);

            row.push({ x, y, isRoad, isIntersection, element: cell });

            if (isIntersection) {
                // Initial signal state random (0=vertical green, 1=horizontal green)
                const state = Math.random() > 0.5 ? 0 : 1;
                
                // Add visual signals for visualization
                const signal = document.createElement('div');
                signal.className = `signal ${state === 0 ? 'signal-green' : 'signal-red'}`;
                cell.appendChild(signal);

                intersections.push({ 
                    x, y, 
                    state, // 0 for V-Green, 1 for H-Green
                    timer: 0,
                    cycleTime: 10 + Math.floor(Math.random() * 5), // cycles
                    signalElement: signal,
                    override: null // 'V' or 'H'
                });
            }
        }
        grid.push(row);
    }
}

function updateAnalytics() {
    document.getElementById('total-vehicles').innerText = vehicles.length + (ambulance ? 1 : 0);
    
    // Congestion based on vehicles on road vs total road capacity
    const roadCells = GRID_SIZE * ROAD_ROWS.length + GRID_SIZE * ROAD_COLS.length - (ROAD_ROWS.length * ROAD_COLS.length);
    const congestionRatio = vehicles.length / roadCells;
    let congestion = 'Low';
    if (congestionRatio > 0.4) congestion = 'High';
    else if (congestionRatio > 0.2) congestion = 'Medium';
    document.getElementById('traffic-congestion').innerText = congestion;

    document.getElementById('time-saved').innerText = timeSaved + 's';
    document.getElementById('nodes-explored').innerText = nodesExplored;
    document.getElementById('signals-updated').innerText = signalsUpdated;

    if (ambulance) {
        document.getElementById('emergency-status').innerText = 'ACTIVE';
        document.getElementById('emergency-status').className = 'status-active';
    } else {
        document.getElementById('emergency-status').innerText = 'INACTIVE';
        document.getElementById('emergency-status').className = 'status-inactive';
        document.getElementById('current-route').innerText = 'None';
        // Clear old paths visually
        for(let r=0; r<GRID_SIZE; r++){
            for(let c=0; c<GRID_SIZE; c++){
                grid[r][c].element.classList.remove('ambulance-path');
            }
        }
    }
}

// Intersections Logic
function updateSignals() {
    intersections.forEach(inst => {
        // AI Override
        if (inst.override !== null) {
            inst.state = inst.override === 'V' ? 0 : 1;
            inst.signalElement.className = `signal signal-green`;
            inst.signalElement.style.boxShadow = '0 0 10px #00f3ff'; // Special neon blue glow when overridden
            return; // Skip normal cycling
        }

        // Normal Cycle
        inst.signalElement.style.boxShadow = ''; // Reset special glow
        inst.timer++;
        if (inst.timer >= inst.cycleTime) {
            inst.state = inst.state === 0 ? 1 : 0;
            inst.timer = 0;
        }

        // Visual update (very simplified: shows green if V, red if H, but actually indicates if horizontal or vertical is green)
        // Let's make it blink yellow maybe? For simplicity: 
        // We'll standardise visual: Green means vertical flow. Red means vertical stop (horizontal go).
        inst.signalElement.className = `signal ${inst.state === 0 ? 'signal-green' : 'signal-red'}`;
    });
}

function isCarAhead(x, y, dx, dy) {
    const nextX = x + dx;
    const nextY = y + dy;
    if (nextX < 0 || nextX >= GRID_SIZE || nextY < 0 || nextY >= GRID_SIZE) return false;
    
    // Check if another vehicle is at nextX, nextY
    for (const v of vehicles) {
        if (v.x === nextX && v.y === nextY) return true;
    }
    if (ambulance && ambulance.x === nextX && ambulance.y === nextY) return true;
    
    return false;
}

function canEnterIntersection(x, y, dx, dy) {
    const nextX = x + dx;
    const nextY = y + dy;
    
    // Are we about to enter an intersection cell?
    const inst = intersections.find(i => i.x === nextX && i.y === nextY);
    if (!inst) return true; // not an intersection

    // If moving vertically (dy != 0), we need state === 0 (or overridden 'V')
    if (dy !== 0) {
        return inst.state === 0;
    }
    // If moving horizontally (dx != 0), we need state === 1 (or overridden 'H')
    if (dx !== 0) {
        return inst.state === 1;
    }
    return true;
}

// Vehicle Classes & Logic
class Vehicle {
    constructor() {
        this.id = ++totalVehicles;
        this.element = document.createElement('div');
        this.isV = Math.random() > 0.5; // moving vertical or horizontal
        
        const types = ['🚗', '🚌', '🚚'];
        this.type = types[Math.floor(Math.random() * types.length)];
        this.element.innerText = this.type;
        
        let validStartCoords = [];
        if (this.isV) {
            // Pick a column
            const col = ROAD_COLS[Math.floor(Math.random() * ROAD_COLS.length)];
            const dir = Math.random() > 0.5 ? 1 : -1;
            validStartCoords = [col, dir === 1 ? -1 : GRID_SIZE];
            this.x = col;
            this.y = dir === 1 ? 0 : GRID_SIZE - 1;
            this.dx = 0;
            this.dy = dir;
            this.element.className = 'vehicle car';
        } else {
            const row = ROAD_ROWS[Math.floor(Math.random() * ROAD_ROWS.length)];
            const dir = Math.random() > 0.5 ? 1 : -1;
            this.x = dir === 1 ? 0 : GRID_SIZE - 1;
            this.y = row;
            this.dx = dir;
            this.dy = 0;
            this.element.className = 'vehicle car';
        }

        // Avoid overlap spawn
        if (isCarAhead(this.x - this.dx, this.y - this.dy, this.dx, this.dy)) {
            this.valid = false;
        } else {
            this.valid = true;
            gridContainer.appendChild(this.element);
            this.updateDOM();
        }
    }

    updateDOM() {
        const cellPercent = 100 / GRID_SIZE;
        this.isV = this.dy !== 0; // update orientation state based on current velocity
        
        this.element.style.left = `${this.x * cellPercent}%`;
        this.element.style.top = `${this.y * cellPercent}%`;

        if (this.dx === 1) {
            this.element.style.transform = 'scaleX(-1)';
        } else if (this.dx === -1) {
            this.element.style.transform = 'rotate(0deg)';
        } else if (this.dy === 1) {
            this.element.style.transform = 'rotate(-90deg)';
        } else if (this.dy === -1) {
            this.element.style.transform = 'rotate(90deg)';
        }
    }

    move() {
        if (!this.valid) return false; // mark for removal

        // Check if path blocked by car
        if (isCarAhead(this.x, this.y, this.dx, this.dy)) return true; // staying alive

        // Check intersections
        if (!canEnterIntersection(this.x, this.y, this.dx, this.dy)) return true; // wait at signal

        // Move
        this.x += this.dx;
        this.y += this.dy;

        // Out of bounds
        if (this.x < 0 || this.x >= GRID_SIZE || this.y < 0 || this.y >= GRID_SIZE) {
            this.valid = false;
            this.element.remove();
            return false;
        }

        this.updateDOM();
        return true;
    }
}

class Ambulance extends Vehicle {
    constructor() {
        super();
        this.element.className = 'vehicle ambulance';
        this.element.innerText = '🚑';
        this.path = [];
        this.target = null;
        this.generateTarget();
        this.calculatePath();
    }

    generateTarget() {
        // Ensure target is on a road but far from start
        let possibleTargets = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                if (grid[r][c].isRoad && (Math.abs(r - this.y) > 5 || Math.abs(c - this.x) > 5)) {
                    possibleTargets.push({x: c, y: r});
                }
            }
        }
        this.target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
    }

    // AI Pathfinding (BFS)
    calculatePath() {
        nodesExplored = 0;
        let queue = [{x: this.x, y: this.y, path: []}];
        let visited = new Set();
        visited.add(`${this.x},${this.y}`);

        // Simple Directions
        const dirs = [
            {dx:0,dy:-1}, {dx:0,dy:1}, {dx:-1,dy:0}, {dx:1,dy:0}
        ];

        while(queue.length > 0) {
            let curr = queue.shift();
            nodesExplored++;

            if (curr.x === this.target.x && curr.y === this.target.y) {
                this.path = curr.path;
                break;
            }

            for (let d of dirs) {
                let nx = curr.x + d.dx;
                let ny = curr.y + d.dy;
                
                if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                    if (grid[ny][nx].isRoad && !visited.has(`${nx},${ny}`)) {
                        visited.add(`${nx},${ny}`);
                        queue.push({
                            x: nx, y: ny, 
                            path: [...curr.path, {x: nx, y: ny, dx: d.dx, dy: d.dy}]
                        });
                    }
                }
            }
        }

        this.drawPath();
    }

    drawPath() {
        // Clear old
        for(let r=0; r<GRID_SIZE; r++){
            for(let c=0; c<GRID_SIZE; c++){
                grid[r][c].element.classList.remove('ambulance-path');
            }
        }
        // Draw new
        if(this.path.length > 0) {
            document.getElementById('current-route').innerText = `(${this.x},${this.y}) → (${this.target.x},${this.target.y})`;
            this.path.forEach(step => {
                grid[step.y][step.x].element.classList.add('ambulance-path');
                
                // Also AI overrides the signal permanently on this path, until ambulance passes
                const inst = intersections.find(i => i.x === step.x && i.y === step.y);
                if (inst) {
                    inst.override = step.dx !== 0 ? 'H' : 'V';
                    signalsUpdated++;
                }
            });
        }
    }

    move() {
        if (this.path.length === 0) {
            // Reached destination or stuck
            this.valid = false;
            this.element.remove();
            
            // Release ALL intersections overrides
            intersections.forEach(i => i.override = null);
            return false;
        }

        // Just take the next step in path
        const nextStep = this.path[0];
        this.dx = nextStep.dx;
        this.dy = nextStep.dy;

        // Although it's an ambulance, it cannot just jump over cars, wait if blocked by a car immediately ahead!
        // But our system overrides lights, so cars should clear out.
        if (isCarAhead(this.x, this.y, this.dx, this.dy)) {
            // Try to recalculate or wait? Let's just wait, cars will move soon
            return true; 
        }

        // We can move
        this.path.shift(); // consume step
        this.x += this.dx;
        this.y += this.dy;
        
        // Remove override of the intersection we just left
        const leftInst = intersections.find(i => i.x === this.x-this.dx && i.y === this.y-this.dy);
        if (leftInst) leftInst.override = null;

        timeSaved += 2; // AI metric representation

        this.updateDOM();
        return true;
    }
}

// Main Simulation Loop
function tick() {
    if (!isRunning) return;

    // Traffic spawn
    if (Math.random() < densityRate) {
        let v = new Vehicle();
        if (v.valid) vehicles.push(v);
    }

    // Update signals
    updateSignals();

    // Check ambulance movement
    if (ambulance) {
        let alive = ambulance.move();
        if (!alive) ambulance = null;
    }

    // Normal vehicles movement
    let i = vehicles.length;
    while(i--) {
        if (!vehicles[i].move()) {
            vehicles[i].element.remove();
            vehicles.splice(i, 1);
        }
    }

    updateAnalytics();
}

// Event Listeners
btnStart.addEventListener('click', () => {
    isRunning = !isRunning;
    if (isRunning) {
        btnStart.innerText = 'Pause Simulation';
        btnStart.classList.replace('primary-btn', 'secondary-btn');
        btnStart.classList.remove('pulse'); // stop glow if was glowing
        if (!simulationInterval) {
            simulationInterval = setInterval(tick, tickSpeed);
        }
    } else {
        btnStart.innerText = 'Start Simulation';
        btnStart.classList.replace('secondary-btn', 'primary-btn');
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
});

btnAddAmbulance.addEventListener('click', () => {
    if (ambulance) return; // Only one ambulance at a time
    ambulance = new Ambulance();
    if (!ambulance.valid) {
        ambulance = null; // failed to spawn
    }
    updateAnalytics();
});

btnReset.addEventListener('click', () => {
    // Stop
    isRunning = false;
    btnStart.innerText = 'Start Simulation';
    btnStart.classList.replace('secondary-btn', 'primary-btn');
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = null;

    // Clear vehicles
    vehicles.forEach(v => v.element.remove());
    vehicles = [];
    if (ambulance) {
        ambulance.element.remove();
        ambulance = null;
    }

    // Reset metrics
    totalVehicles = 0;
    timeSaved = 0;
    nodesExplored = 0;
    signalsUpdated = 0;

    initGrid();
    updateAnalytics();
});

densitySelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'low') densityRate = 0.02;
    if (val === 'medium') densityRate = 0.05;
    if (val === 'high') densityRate = 0.15;
});

speedSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'slow') tickSpeed = 800;
    if (val === 'medium') tickSpeed = 400;
    if (val === 'fast') tickSpeed = 150;
    
    // Restart interval if running
    if (isRunning) {
        clearInterval(simulationInterval);
        simulationInterval = setInterval(tick, tickSpeed);
    }
});

// Boot up
initGrid();
updateAnalytics();

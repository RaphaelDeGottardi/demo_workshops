// GO2 Maze Simulator: steer a dog through a 2D maze with your Teachable Machine model.
// Everything runs in this browser; the server only stores finished times.

// --- Fixed maze (change MAZE_ID when changing the layout: it starts a new leaderboard) ---
// '#' = wall. Cells sit at odd row/column positions; the characters between them are walls or gaps.
const MAZE_ID = 'maze-1';
const MAZE = [
    '###################',
    '#   #             #',
    '### # # ### # ### #',
    '#   # #   # #   # #',
    '# ### ### # ### # #',
    '#     #   # #   # #',
    '####### ### # ### #',
    '#     # #     # # #',
    '# ### # # # ### # #',
    '#   #   # # #   # #',
    '### # ##### # ### #',
    '#           #     #',
    '# # # # ##### #####',
    '#     #           #',
    '###################',
];
const COLS = (MAZE[0].length - 1) / 2;
const ROWS = (MAZE.length - 1) / 2;
const START = { x: 0, y: 0, heading: 0 };   // top-left cell, facing east (right)
const GOAL = { x: COLS - 1, y: ROWS - 1 };  // bottom-right cell

// --- Fixed settings (same for everyone). Units: cells and radians. ---
const FORWARD_SPEED = 1.5;                  // cells per second
const TURN_SPEED = Math.PI * 2 / 3;         // 120° per second
const BACKWARD_SPEED = FORWARD_SPEED * 0.7; // same ratio as the robot
const DOG_RADIUS = 0.28;
const WALL_HALF_WIDTH = 0.05;
const AI = { bufferSize: 3, consensusRequired: 2, confidenceThreshold: 0.65 }; // robot defaults

const INFERENCE_FPS = 10;
const LEADERBOARD_POLL_MS = 5000;

// --- State ---
let models = [];
let currentModel = null;   // model info from /models
let browserModel = null;   // loaded tmImage model
let frameInFlight = false;
let predictionBuffer = [];
let currentCommand = 'Idle';

let runState = 'idle';     // idle | ready | countdown | running | finished
let runStart = 0;
let runElapsed = 0;
let countdownTimer = null;
let dog = { x: START.x + 0.5, y: START.y + 0.5, heading: START.heading };

let leaderboardRange = 'today';
let todayEntries = [];     // today's leaderboard, for the 'Best today' status
let walls = [];            // wall segments [x1, y1, x2, y2] in cell units
let canvas, ctx, cellPx = 40;

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('maze-canvas');
    ctx = canvas.getContext('2d');
    walls = buildWalls();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    initializeWebcam();
    initUploadForm(async (data) => {
        await loadModelsList();
        document.getElementById('model-select').value = data.filename;
        renderModelMapping(data.model);
    });
    loadModelsList();

    document.getElementById('load-model-btn').addEventListener('click', loadSelectedModel);
    document.getElementById('sim-start-btn').addEventListener('click', startRun);
    document.getElementById('sim-restart-btn').addEventListener('click', startRun);
    document.getElementById('lb-today-btn').addEventListener('click', () => setLeaderboardRange('today'));
    document.getElementById('lb-all-btn').addEventListener('click', () => setLeaderboardRange('all'));

    loadLeaderboard();
    setInterval(loadLeaderboard, LEADERBOARD_POLL_MS);
    setInterval(predictFrame, 1000 / INFERENCE_FPS);
    requestAnimationFrame(frame);
});

// --- Camera & model ---

async function initializeWebcam() {
    const video = document.getElementById('webcam');
    try {
        video.srcObject = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        updateDisplay('Camera Ready - select a model', 'info');
    } catch (e) {
        console.error(e);
        updateDisplay('Camera Access Denied', 'error');
        showToast('Camera permission required!', 'error');
    }
}

async function loadModelsList() {
    try {
        const res = await fetch('/models');
        const data = await res.json();
        models = data.models || [];
        const select = document.getElementById('model-select');
        const selected = select.value;
        fillModelSelect(select, models);
        if (models.some(m => m.filename === selected)) select.value = selected;
    } catch (e) {
        showToast('Failed to load models list', 'error');
    }
}

// Load the model only in this browser: it never touches the robot or the pilot lock
async function loadSelectedModel() {
    const filename = document.getElementById('model-select').value;
    const info = models.find(m => m.filename === filename);
    if (!info) {
        showToast('Please select a model first', 'warning');
        return;
    }

    const btn = document.getElementById('load-model-btn');
    btn.disabled = true;
    btn.textContent = 'Loading in browser...';
    try {
        browserModel = await loadBrowserModel(info);
        currentModel = info;
        predictionBuffer = [];
        currentCommand = 'Idle';
        resetRun('ready');
        document.getElementById('model-status').textContent = info.name;
        renderModelMapping(info);
        renderClassBars(info.labels, null);
        updateBestStatus();
        showToast('Model loaded - press Start', 'success');
    } catch (e) {
        console.error(e);
        showToast('Failed to load model', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load Selected Model';
    }
}

// Runs whenever a model is loaded, so the bars are live even before Start
async function predictFrame() {
    const video = document.getElementById('webcam');
    if (!browserModel || !video.videoWidth || frameInFlight) return;
    frameInFlight = true;
    try {
        // Same preprocessing as the Teachable Machine preview (centre crop, [-1,1])
        const predictions = await browserModel.predict(video);
        const probabilities = predictions.map(p => p.probability);
        renderClassBars(predictions.map(p => p.className), probabilities);

        const decision = decideCommand(probabilities);
        currentCommand = runState === 'running' ? decision.command : 'Idle';

        let text = `${decision.prediction} (${(decision.confidence * 100).toFixed(0)}%)`;
        if (decision.command !== 'Idle') text += ` -> ${COMMAND_ARROWS[decision.command]} ${decision.command}`;
        updateDisplay(text, decision.command !== 'Idle' ? 'success' : 'info');
    } catch (e) {
        console.error(e);
    } finally {
        frameInFlight = false;
    }
}

// Same rules as process_probabilities() on the server, with the fixed AI settings
function decideCommand(probabilities) {
    let top = 0;
    probabilities.forEach((p, i) => { if (p > probabilities[top]) top = i; });
    const confidence = probabilities[top];
    const predicted = currentModel.commands[top] || 'Idle';

    predictionBuffer.push(predicted);
    if (predictionBuffer.length > AI.bufferSize) predictionBuffer.shift();

    let command = 'Idle';
    if (predictionBuffer.length >= AI.bufferSize) {
        const counts = {};
        predictionBuffer.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
        const [mostCommon, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (mostCommon !== 'Idle' && count >= AI.consensusRequired && confidence >= AI.confidenceThreshold) {
            command = mostCommon;
        }
    }
    return { prediction: currentModel.labels[top], confidence, command };
}

// --- Run flow ---

function startRun() {
    if (!browserModel) return;
    resetRun('countdown');
    let count = 3;
    const el = document.getElementById('sim-countdown');
    el.textContent = count;
    el.style.display = 'flex';
    countdownTimer = setInterval(() => {
        count -= 1;
        if (count > 0) {
            el.textContent = count;
            return;
        }
        clearInterval(countdownTimer);
        countdownTimer = null;
        el.textContent = 'Go!';
        setTimeout(() => { if (runState === 'running') el.style.display = 'none'; }, 600);
        predictionBuffer = [];
        runState = 'running';
        runStart = performance.now();
        updateRunButtons();
    }, 1000);
    updateRunButtons();
}

// Put the dog back at the start without recording anything
function resetRun(state) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    document.getElementById('sim-countdown').style.display = 'none';
    dog = { x: START.x + 0.5, y: START.y + 0.5, heading: START.heading };
    currentCommand = 'Idle';
    runElapsed = 0;
    runState = state;
    updateTimer();
    updateRunButtons();
}

async function finishRun() {
    runState = 'finished';
    currentCommand = 'Idle';
    runElapsed = performance.now() - runStart;
    updateTimer();
    updateRunButtons();

    const el = document.getElementById('sim-countdown');
    el.textContent = '🏁 ' + formatTime(runElapsed);
    el.style.display = 'flex';

    try {
        const res = await fetch('/api/leaderboard', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ filename: currentModel.filename, time_ms: Math.round(runElapsed), maze_id: MAZE_ID })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Could not save the time', 'error');
        } else if (data.new_best_today) {
            showToast(`New best for ${data.name}: ${formatTime(data.time_ms)}!`, 'success');
        } else {
            showToast(`${formatTime(data.time_ms)} - best today stays ${formatTime(data.best_today_ms)}`, 'info');
        }
    } catch (e) {
        showToast('Could not save the time', 'error');
    }
    loadLeaderboard();
}

function updateRunButtons() {
    document.getElementById('sim-start-btn').disabled = !browserModel || runState === 'countdown' || runState === 'running';
    document.getElementById('sim-restart-btn').disabled = runState !== 'countdown' && runState !== 'running' && runState !== 'finished';
}

function updateTimer() {
    document.getElementById('sim-timer').textContent = formatTime(runElapsed);
}

function formatTime(ms) {
    const seconds = ms / 1000;
    if (seconds < 60) return seconds.toFixed(1) + ' s';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

// --- Physics ---

function frame(now) {
    const dt = Math.min((now - (frame.last || now)) / 1000, 0.05); // clamp after tab switches
    frame.last = now;

    if (runState === 'running') {
        moveDog(dt);
        runElapsed = now - runStart;
        updateTimer();
        if (Math.floor(dog.x) === GOAL.x && Math.floor(dog.y) === GOAL.y) finishRun();
    }
    draw();
    requestAnimationFrame(frame);
}

function moveDog(dt) {
    // Screen y points down, so turning left (counter-clockwise) decreases the heading
    if (currentCommand === 'Left') dog.heading -= TURN_SPEED * dt;
    if (currentCommand === 'Right') dog.heading += TURN_SPEED * dt;

    let speed = 0;
    if (currentCommand === 'Forward') speed = FORWARD_SPEED;
    if (currentCommand === 'Backwards') speed = -BACKWARD_SPEED;
    if (!speed) return;

    // Move each axis separately so the dog slides along walls instead of sticking
    const dx = Math.cos(dog.heading) * speed * dt;
    const dy = Math.sin(dog.heading) * speed * dt;
    if (!collides(dog.x + dx, dog.y)) dog.x += dx;
    if (!collides(dog.x, dog.y + dy)) dog.y += dy;
}

function collides(x, y) {
    const limit = DOG_RADIUS + WALL_HALF_WIDTH;
    return walls.some(([x1, y1, x2, y2]) => {
        // Distance from (x, y) to an axis-aligned segment
        const cx = Math.max(Math.min(x, Math.max(x1, x2)), Math.min(x1, x2));
        const cy = Math.max(Math.min(y, Math.max(y1, y2)), Math.min(y1, y2));
        return (x - cx) ** 2 + (y - cy) ** 2 < limit * limit;
    });
}

// Turn the character map into wall segments between cells (in cell units)
function buildWalls() {
    const segments = [];
    for (let r = 0; r < MAZE.length; r++) {
        for (let c = 0; c < MAZE[r].length; c++) {
            if (MAZE[r][c] !== '#') continue;
            if (r % 2 === 0 && c % 2 === 1) segments.push([(c - 1) / 2, r / 2, (c + 1) / 2, r / 2]); // horizontal
            if (r % 2 === 1 && c % 2 === 0) segments.push([c / 2, (r - 1) / 2, c / 2, (r + 1) / 2]); // vertical
        }
    }
    return segments;
}

// --- Drawing ---

function resizeCanvas() {
    const width = canvas.parentElement.clientWidth;
    cellPx = width / COLS;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = cellPx * ROWS * ratio;
    canvas.style.height = cellPx * ROWS + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw() {
    const w = COLS * cellPx, h = ROWS * cellPx;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Start and goal cells
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(START.x * cellPx, START.y * cellPx, cellPx, cellPx);
    ctx.fillStyle = '#dcfce7';
    ctx.fillRect(GOAL.x * cellPx, GOAL.y * cellPx, cellPx, cellPx);
    ctx.font = `${Math.round(cellPx * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏁', (GOAL.x + 0.5) * cellPx, (GOAL.y + 0.5) * cellPx);

    // Walls
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = Math.max(3, WALL_HALF_WIDTH * 2 * cellPx);
    ctx.lineCap = 'round';
    ctx.beginPath();
    walls.forEach(([x1, y1, x2, y2]) => {
        ctx.moveTo(x1 * cellPx, y1 * cellPx);
        ctx.lineTo(x2 * cellPx, y2 * cellPx);
    });
    ctx.stroke();

    drawDog();
}

// Top-down dog, drawn with shapes so it looks the same on every laptop
function drawDog() {
    const s = DOG_RADIUS * cellPx;
    ctx.save();
    ctx.translate(dog.x * cellPx, dog.y * cellPx);
    ctx.rotate(dog.heading);

    ctx.strokeStyle = '#7c4a1e';                   // tail
    ctx.lineWidth = s * 0.18;
    ctx.beginPath();
    ctx.moveTo(-s * 0.8, 0);
    ctx.lineTo(-s * 1.15, s * 0.25);
    ctx.stroke();

    ctx.fillStyle = '#c47a3a';                     // body
    ctx.beginPath();
    ctx.ellipse(-s * 0.15, 0, s * 0.75, s * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#7c4a1e';                     // ears
    ctx.beginPath();
    ctx.ellipse(s * 0.45, -s * 0.38, s * 0.22, s * 0.12, -0.5, 0, Math.PI * 2);
    ctx.ellipse(s * 0.45, s * 0.38, s * 0.22, s * 0.12, 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d9914f';                     // head
    ctx.beginPath();
    ctx.arc(s * 0.6, 0, s * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1f2937';                     // nose shows the direction
    ctx.beginPath();
    ctx.arc(s * 0.98, 0, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// --- Leaderboard ---

function setLeaderboardRange(range) {
    leaderboardRange = range;
    document.getElementById('lb-today-btn').classList.toggle('active', range === 'today');
    document.getElementById('lb-all-btn').classList.toggle('active', range === 'all');
    loadLeaderboard();
}

async function loadLeaderboard() {
    try {
        const [shown, today] = await Promise.all([
            fetch(`/api/leaderboard?range=${leaderboardRange}&maze_id=${MAZE_ID}`).then(r => r.json()),
            leaderboardRange === 'today' ? null : fetch(`/api/leaderboard?range=today&maze_id=${MAZE_ID}`).then(r => r.json()),
        ]);
        todayEntries = (today || shown).entries;
        renderLeaderboard(shown.entries);
        updateBestStatus();
    } catch (e) {
        console.error('Leaderboard failed', e);
    }
}

function renderLeaderboard(entries) {
    const body = document.getElementById('leaderboard-body');
    const showDate = leaderboardRange === 'all';
    document.getElementById('lb-date-header').style.display = showDate ? '' : 'none';

    if (!entries.length) {
        const text = leaderboardRange === 'today' ? 'No times yet today. Be the first!' : 'No times yet.';
        body.innerHTML = `<tr><td colspan="4" class="leaderboard-empty">${text}</td></tr>`;
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    body.innerHTML = entries.map(e => {
        const mine = currentModel && e.name === currentModel.name ? ' class="mine"' : '';
        const date = showDate ? `<td>${new Date(e.date).toLocaleDateString()}</td>` : '';
        return `<tr${mine}><td>${medals[e.rank - 1] || e.rank}</td><td>${escapeHtml(e.name)}</td><td>${formatTime(e.time_ms)}</td>${date}</tr>`;
    }).join('');
}

function updateBestStatus() {
    const entry = currentModel && todayEntries.find(e => e.name === currentModel.name);
    document.getElementById('best-status').textContent = entry ? formatTime(entry.time_ms) : '-';
}

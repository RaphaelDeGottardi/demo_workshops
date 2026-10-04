// GO2 Control Page JavaScript

// State
let currentState = {
    inferenceActive: false,
    modelLoaded: false,
    currentModel: null, // model info from the server (type, labels, commands, ...)
    isPilot: false,
    viewMode: 'local' // 'local' or 'pilot'
};

// Teachable Machine TensorFlow.js model running in this browser (see shared.js)
let browserModel = null;

let inferenceInterval = null;
let pilotFeedInterval = null;
let frameInFlight = false;
const INFERENCE_FPS = 10;

document.addEventListener('DOMContentLoaded', () => {
    initializeWebcam();
    initializeControls();
    initUploadForm(async (data) => {
        await loadModelsList();
        // Preselect the new model and show how its classes map to robot moves
        document.getElementById('model-select').value = data.filename;
        renderModelMapping(data.model);
    });
    loadModelsList();
    loadSettings();
    startStatusPolling();
});

// --- Initialization ---

async function initializeWebcam() {
    const video = document.getElementById('webcam');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        video.srcObject = stream;
        updateDisplay('Camera Ready', 'info');
    } catch (e) {
        console.error(e);
        updateDisplay('Camera Access Denied', 'error');
        showToast('Camera permission required!', 'error');
    }
}

function initializeControls() {
    document.getElementById('load-model-btn').addEventListener('click', loadSelectedModel);
    document.getElementById('start-btn').addEventListener('click', startInference);
    document.getElementById('stop-btn').addEventListener('click', stopInference);
    document.getElementById('emergency-btn').addEventListener('click', emergencyStop);
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
    
    document.getElementById('take-control-btn').addEventListener('click', takeControl);
    document.getElementById('relinquish-btn').addEventListener('click', relinquishControl);
    
    document.getElementById('show-local-btn').addEventListener('click', () => setViewMode('local'));
    document.getElementById('show-pilot-btn').addEventListener('click', () => setViewMode('pilot'));
    
    // Sliders
    const confSlider = document.getElementById('confidence-threshold');
    const speedSlider = document.getElementById('max-speed');
    const rateSlider = document.getElementById('command-rate');
    const bufSlider = document.getElementById('buffer-size');
    const conSlider = document.getElementById('consensus-req');

    confSlider.addEventListener('input', (e) => document.getElementById('confidence-value').textContent = e.target.value + '%');
    speedSlider.addEventListener('input', (e) => document.getElementById('speed-value').textContent = e.target.value);
    
    if(rateSlider) rateSlider.addEventListener('input', (e) => document.getElementById('rate-value').textContent = e.target.value);
    
    if(bufSlider && conSlider) {
        // When buffer size changes
        bufSlider.addEventListener('input', (e) => {
            const bufVal = parseInt(e.target.value);
            document.getElementById('buffer-value').textContent = bufVal;
            
            // Adjust Consensus limits
            conSlider.max = bufVal;
            const minConsensus = Math.ceil(bufVal / 2);
            conSlider.min = minConsensus;
            
            // Clamp current consensus to new limits
            if (parseInt(conSlider.value) > bufVal) {
                conSlider.value = bufVal;
            } else if (parseInt(conSlider.value) < minConsensus) {
                conSlider.value = minConsensus;
            }
            document.getElementById('consensus-value').textContent = conSlider.value;
        });

        // When consensus changes directly
        conSlider.addEventListener('input', (e) => {
             const bufVal = parseInt(bufSlider.value);
             const minConsensus = Math.ceil(bufVal / 2);
             
             if (parseInt(e.target.value) < minConsensus) {
                 e.target.value = minConsensus;
             }
             document.getElementById('consensus-value').textContent = e.target.value;
        });
    }
}

// --- View Mode & Pilot Feed ---

function setViewMode(mode) {
    currentState.viewMode = mode;
    const localBtn = document.getElementById('show-local-btn');
    const pilotBtn = document.getElementById('show-pilot-btn');
    const video = document.getElementById('webcam');
    const pilotImg = document.getElementById('pilot-feed');

    if (mode === 'local') {
        localBtn.classList.add('active');
        localBtn.style.background = '#444';
        pilotBtn.classList.remove('active');
        pilotBtn.style.background = 'transparent';
        video.style.display = 'block';
        pilotImg.style.display = 'none';
        
        if (pilotFeedInterval) {
            clearInterval(pilotFeedInterval);
            pilotFeedInterval = null;
        }
        if (!currentState.inferenceActive) resetClassBars();
    } else {
        pilotBtn.classList.add('active');
        pilotBtn.style.background = '#444';
        localBtn.classList.remove('active');
        localBtn.style.background = 'transparent';
        video.style.display = 'none';
        pilotImg.style.display = 'block';
        
        // Start polling pilot feed
        if (!pilotFeedInterval) {
            pilotFeedInterval = setInterval(fetchPilotFrame, 1000 / INFERENCE_FPS);
        }
    }
}

async function fetchPilotFrame() {
    if (currentState.isPilot && currentState.viewMode === 'pilot') {
        // If we are pilot, "pilot view" is just our own local frames anyway
        setViewMode('local'); 
        return;
    }

    try {
        const res = await fetch('/api/pilot_frame');
        const data = await res.json();
        if (data.image) {
            document.getElementById('pilot-feed').src = data.image;
        }
        
        // Update prediction display if in pilot mode
        if (data.prediction && currentState.viewMode === 'pilot') {
            const pred = data.prediction;
            const conf = (pred.confidence * 100).toFixed(0);
            const cmd = pred.command_to_execute;
            renderClassBars(pred.labels, pred.probabilities);

            let text = `Pilot Seeing: ${pred.prediction} (${conf}%)`;
            if (cmd && cmd !== 'Idle') {
                text += ` -> EXECUTE: ${cmd}`;
                document.getElementById('last-cmd').textContent = cmd;
            }
            updateDisplay(text, cmd !== 'Idle' ? 'success' : 'info');
        }
    } catch (e) {
        console.error('Failed to fetch pilot frame', e);
    }
}

// --- Model Logic ---

async function loadModelsList() {
    const select = document.getElementById('model-select');
    try {
        const res = await fetch('/models');
        const data = await res.json();
        
        if (data.models) {
            fillModelSelect(select, data.models);

            // Show the model that is currently loaded (shared by all groups)
            const current = data.models.find(m => m.filename === data.current) || null;
            if (current) select.value = current.filename;
            setCurrentModel(current);
        }
    } catch (e) {
        showToast('Failed to load models list', 'error');
    }
}

function setCurrentModel(info) {
    currentState.currentModel = info;
    currentState.modelLoaded = !!info;
    document.getElementById('model-status').textContent = info ? info.name : 'None';
    renderModelMapping(info);
    renderClassBars(info ? info.labels : null, null);
    updateButtons();
}

function resetClassBars() {
    const model = currentState.currentModel;
    renderClassBars(model ? model.labels : null, null);
}

// Load the selected TF.js model into this browser (no-op if already loaded)
async function ensureBrowserModel() {
    browserModel = await loadBrowserModel(currentState.currentModel);
}

async function loadSelectedModel() {
    const select = document.getElementById('model-select');
    const filename = select.value;
    
    if (!filename) {
        showToast('Please select a model first', 'warning');
        return;
    }
    
    const btn = document.getElementById('load-model-btn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    
    try {
        const formData = new FormData();
        formData.append('filename', filename);
        
        const res = await fetch('/load_model', {
            method: 'POST',
            body: formData
        });
        
        if (res.ok) {
            const data = await res.json();
            setCurrentModel(data.model);
            btn.textContent = 'Loading in browser...';
            await ensureBrowserModel();
            showToast('Model loaded successfully', 'success');
            updateDisplay('Model Ready - Press Start', 'success');
        } else {
            const err = await res.json();
            showToast(`Error: ${err.error}`, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Failed to load model', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load Selected Model';
    }
}

// --- Inference Logic ---

async function startInference() {
    if (!currentState.modelLoaded || !currentState.isPilot) return;

    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';
    updateDisplay('Starting control...', 'info');

    try {
        await ensureBrowserModel();

        const res = await fetch('/start_inference', {
            method: 'POST'
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
            const message = data.error || data.message || 'Failed to start control';
            showToast(message, 'error');
            updateDisplay('Start failed', 'error');
            return;
        }

        currentState.inferenceActive = true;
        if (inferenceInterval) clearInterval(inferenceInterval);
        inferenceInterval = setInterval(sendFrame, 1000 / INFERENCE_FPS);
        updateDisplay('Running...', 'success');
        showToast('Control started', 'success');
    } catch (e) {
        showToast('Failed to connect to server', 'error');
        updateDisplay('Start failed', 'error');
    } finally {
        startBtn.textContent = '▶️ Start Control';
        updateButtons();
    }
}

function stopInference(notifyServer = true) {
    currentState.inferenceActive = false;
    if (inferenceInterval) clearInterval(inferenceInterval);
    updateButtons();
    updateDisplay('Stopped', 'warning');
    resetClassBars();

    if (notifyServer) {
        fetch('/stop_inference', { method: 'POST' });
    }
}

async function emergencyStop() {
    if (!currentState.isPilot) return;
    stopInference();
    await fetch('/emergency_stop', { method: 'POST' });
    showToast('EMERGENCY STOP TRIGGERED', 'error');
}

async function sendFrame() {
    if (!currentState.isPilot) {
        stopInference(false);
        return;
    }

    const video = document.getElementById('webcam');
    const model = currentState.currentModel;
    // Skip if the camera isn't ready or the previous frame is still being processed
    if (!model || !video.videoWidth || frameInFlight) return;
    frameInFlight = true;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const start = Date.now();

    try {
        await ensureBrowserModel();
        const predictions = await predictWebcam(browserModel, video);
        if (!currentState.inferenceActive) return; // stopped while predicting
        renderClassBars(predictions.map(p => p.className), predictions.map(p => p.probability));

        // Small frame for the pilot view on other devices: the same centre square the model sees
        const side = Math.min(video.videoWidth, video.videoHeight);
        canvas.width = canvas.height = PILOT_FRAME_SIZE;
        ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side,
                      0, 0, PILOT_FRAME_SIZE, PILOT_FRAME_SIZE);

        const res = await fetch('/submit_prediction', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                probabilities: predictions.map(p => p.probability),
                image: canvas.toDataURL('image/jpeg', 0.7)
            })
        });

        const data = await res.json();
        if (data.model_changed) loadModelsList();
        const latency = Date.now() - start;
        document.getElementById('latency-val').textContent = latency;
        
        if (res.ok && currentState.inferenceActive) {
            const conf = (data.confidence * 100).toFixed(0);
            const cmd = data.command_to_execute;

            let text = `${data.prediction} (${conf}%)`;
            if (cmd && cmd !== 'Idle') {
                text += ` -> EXECUTE: ${cmd}`;
                document.getElementById('last-cmd').textContent = cmd;
            }
            
            updateDisplay(text, cmd !== 'Idle' ? 'success' : 'info');
        }
    } catch (e) {
        console.error(e);
    } finally {
        frameInFlight = false;
    }
}

// --- Settings ---

function loadSettings() {
    fetch('/settings')
        .then(r => r.json())
        .then(data => {
            if (data) {
                // Basic
                if(data.confidence_threshold) {
                    document.getElementById('confidence-threshold').value = data.confidence_threshold * 100;
                    document.getElementById('confidence-value').textContent = (data.confidence_threshold * 100) + '%';
                }
                if(data.max_speed) {
                    document.getElementById('max-speed').value = data.max_speed;
                    document.getElementById('speed-value').textContent = data.max_speed;
                }

                // Advanced
                if (data.command_interval && document.getElementById('command-rate')) {
                    const rate = (1 / data.command_interval).toFixed(1); // Interval to Rate? Or just raw interval
                    // Actually UI shows "Command Rate" but backend uses interval. 
                    // Let's assume UI Slider is interval for simplicity or mapped?
                    // The old teacher dashboard mapped Rate (Hz) to Interval (1/Hz)
                    // But in the HTML I set usage <input ... value="1.0"> /sec (Interval)
                    // Wait, labeling in HTML says "Command Rate ... (Interval)" which is confusing.
                    // Let's treat the slider as "Interval (Seconds)" to be safe, or just raw value.
                    // The HTML says `min="0.1" max="2.0" value="1.0" step="0.1"`. This looks like seconds (Interval).
                    // If it was Hz, max 2.0 would be very slow. 
                    // Let's assume the slider is Interval in Seconds.
                    
                    document.getElementById('command-rate').value = data.command_interval;
                    document.getElementById('rate-value').textContent = data.command_interval;
                }
                
                if (data.buffer_size && document.getElementById('buffer-size')) {
                    document.getElementById('buffer-size').value = data.buffer_size;
                    document.getElementById('buffer-value').textContent = data.buffer_size;
                    
                    // Update consensus limits based on loaded buffer size
                    const conSlider = document.getElementById('consensus-req');
                    if (conSlider) {
                        conSlider.max = data.buffer_size;
                        conSlider.min = Math.ceil(data.buffer_size / 2);
                    }
                }
                
                if (data.consensus_required && document.getElementById('consensus-req')) {
                    document.getElementById('consensus-req').value = data.consensus_required;
                    document.getElementById('consensus-value').textContent = data.consensus_required;
                }
            }
        });
}

function saveSettings() {
    const conf = document.getElementById('confidence-threshold').value / 100;
    const speed = document.getElementById('max-speed').value;
    
    // Advanced
    const rateEl = document.getElementById('command-rate');
    const bufEl = document.getElementById('buffer-size');
    const conEl = document.getElementById('consensus-req');
    
    const payload = {
        confidence_threshold: conf,
        max_speed: parseFloat(speed)
    };

    if (rateEl) payload.command_interval = parseFloat(rateEl.value);
    if (bufEl) payload.buffer_size = parseInt(bufEl.value);
    if (conEl) payload.consensus_required = parseInt(conEl.value);
    
    fetch('/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(res => {
        if (res.ok) showToast('Settings saved', 'success');
    });
}

// --- Status Polling ---

function startStatusPolling() {
    setInterval(async () => {
        try {
            const res = await fetch('/status');
            const data = await res.json();
            
            const rStatus = document.getElementById('robot-status');
            if (rStatus) {
                rStatus.textContent = data.robot_connected ? 'Connected' : 'Disconnected';
                rStatus.className = 'status-value ' + (data.robot_connected ? 'connected' : 'disconnected');
            }
            
            // Another pilot may have loaded (or deleted) a model
            const shownModel = currentState.currentModel ? currentState.currentModel.filename : null;
            if ((data.current_model || null) !== shownModel) {
                loadModelsList();
            }

            // Sync local state if changed externally
            if (data.inference_enabled !== currentState.inferenceActive) {
                if (data.inference_enabled && currentState.isPilot) {
                    // Only start if we are pilot and it was enabled elsewhere? 
                    // Unlikely but keep it safe.
                } else if (!data.inference_enabled) {
                    stopInference(false); // Stop local loop, don't tell server back
                }
            }
            
        } catch (e) {}
    }, 2000);
}

// --- Helpers ---

function updateButtons() {
    const isPilot = currentState.isPilot;
    
    document.getElementById('start-btn').disabled = !currentState.modelLoaded || currentState.inferenceActive || !isPilot;
    document.getElementById('stop-btn').disabled = !currentState.inferenceActive || !isPilot;
    document.getElementById('emergency-btn').disabled = !isPilot;
    document.getElementById('load-model-btn').disabled = !isPilot;
    document.getElementById('save-settings-btn').disabled = !isPilot;
    
    // Also disable configuration inputs if not pilot, but ALLOW uploading models
    const inputs = document.querySelectorAll('.model-panel input, .model-panel select');
    inputs.forEach(input => {
        // Only disable if NOT part of the upload form
        if (!input.closest('#upload-form')) {
            input.disabled = !isPilot;
        }
    });
}

// --- Pilot Management ---

async function pollPilotStatus() {
    try {
        const res = await fetch('/api/control_status');
        const data = await res.json();
        
        currentState.isPilot = data.is_pilot;
        
        const pilotStatus = document.getElementById('pilot-status');
        const takeBtn = document.getElementById('take-control-btn');
        const relBtn = document.getElementById('relinquish-btn');
        const pilotMsg = document.getElementById('pilot-message');
        
        if (data.system_locked) {
            pilotStatus.textContent = 'SYSTEM LOCKED';
            pilotStatus.className = 'status-value error';
            takeBtn.style.display = 'none';
            relBtn.style.display = 'none';
            pilotMsg.textContent = 'The teacher has locked the system.';
            currentState.isPilot = false; // Force false if locked
        } else if (data.current_pilot) {
            if (data.is_pilot) {
                pilotStatus.textContent = 'YOU';
                pilotStatus.className = 'status-value connected';
                takeBtn.style.display = 'none';
                relBtn.style.display = 'inline-block';
                pilotMsg.textContent = 'You have control of the robot.';
            } else {
                pilotStatus.textContent = 'Another Student';
                pilotStatus.className = 'status-value warning';
                takeBtn.style.display = 'none';
                relBtn.style.display = 'none';
                pilotMsg.textContent = 'Someone else is driving.';
            }
        } else {
            pilotStatus.textContent = 'Available';
            pilotStatus.className = 'status-value disconnected';
            takeBtn.style.display = 'inline-block';
            relBtn.style.display = 'none';
            pilotMsg.textContent = 'Nobody is driving. Take control to start!';
        }
        
        updateButtons();
    } catch (e) {
        console.error('Pilot poll failed', e);
    }
}

async function takeControl() {
    try {
        const res = await fetch('/api/take_control', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('Control acquired!', 'success');
            pollPilotStatus();
        } else {
            showToast(data.message || 'Could not take control', 'warning');
        }
    } catch (e) {
        showToast('Server error', 'error');
    }
}

async function relinquishControl() {
    try {
        await fetch('/api/relinquish_control', { method: 'POST' });
        showToast('Control released');
        pollPilotStatus();
    } catch (e) {}
}

// Start polling
setInterval(pollPilotStatus, 2000);
pollPilotStatus();

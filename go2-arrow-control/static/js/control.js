// GO2 Control Page JavaScript

// State
let currentState = {
    inferenceActive: false,
    modelLoaded: false,
    isPilot: false,
    viewMode: 'local' // 'local' or 'pilot'
};

let inferenceInterval = null;
let pilotFeedInterval = null;
const INFERENCE_FPS = 10;

document.addEventListener('DOMContentLoaded', () => {
    initializeWebcam();
    initializeControls();
    initializeUploadForm();
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

// --- Upload Logic ---

function initializeUploadForm() {
    const form = document.getElementById('upload-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('model-name');
        const fileInput = document.getElementById('model-file');
        const submitBtn = form.querySelector('button[type="submit"]');

        const formData = new FormData();
        formData.append('model_name', nameInput.value);
        formData.append('model', fileInput.files[0]);

        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';

        try {
            const res = await fetch('/upload_model', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Model uploaded!', 'success');
                form.reset();
                loadModelsList();
            } else {
                showToast(data.error, 'error');
            }
        } catch (e) {
            showToast('Upload failed', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload Model';
        }
    });
}

// --- Model Logic ---

async function loadModelsList() {
    const select = document.getElementById('model-select');
    try {
        const res = await fetch('/models');
        const data = await res.json();
        
        // Keep first option
        select.innerHTML = '<option value="">-- Choose a Model --</option>';
        
        if (data.models) {
            // Count occurrences of each model name to detect duplicates
            const nameCounts = {};
            data.models.forEach(m => {
                nameCounts[m.name] = (nameCounts[m.name] || 0) + 1;
            });

            data.models.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.filename;
                
                // If there are multiple models with the same name, show the timestamp to distinguish them.
                // Otherwise, just show the clean model name.
                if (nameCounts[model.name] > 1) {
                    const dateObj = new Date(model.modified);
                    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    opt.textContent = `${model.name} (${timeStr})`;
                } else {
                    opt.textContent = model.name;
                }
                select.appendChild(opt);
            });
            
            // If check existing current model
            if (data.current) {
                select.value = data.current;
                currentState.modelLoaded = true;
                updateButtons();
            }
        }
    } catch (e) {
        showToast('Failed to load models list', 'error');
    }
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
            showToast('Model loaded successfully', 'success');
            currentState.modelLoaded = true;
            document.getElementById('model-status').textContent = filename.split('_')[0];
            updateDisplay('Model Ready - Press Start', 'success');
            updateButtons();
        } else {
            const err = await res.json();
            showToast(`Error: ${err.error}`, 'error');
        }
    } catch (e) {
        showToast('Failed to connect to server', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load Selected Model';
    }
}

// --- Inference Logic ---

function startInference() {
    if (!currentState.modelLoaded) return;
    currentState.inferenceActive = true;
    
    inferenceInterval = setInterval(sendFrame, 1000 / INFERENCE_FPS);
    updateButtons();
    updateDisplay('Running...', 'success');
    
    // Update server state
    fetch('/start_inference', {
        method: 'POST'
    });
}

function stopInference(notifyServer = true) {
    currentState.inferenceActive = false;
    if (inferenceInterval) clearInterval(inferenceInterval);
    updateButtons();
    updateDisplay('Stopped', 'warning');
    
    if (notifyServer) {
        fetch('/stop_inference', { method: 'POST' });
    }
}

async function emergencyStop() {
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
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    const image = canvas.toDataURL('image/jpeg', 0.8);
    const start = Date.now();
    
    try {
        const res = await fetch('/predict_frame', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ image })
        });
        
        const data = await res.json();
        const latency = Date.now() - start;
        document.getElementById('latency-val').textContent = latency;
        
        if (res.ok) {
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

function updateDisplay(text, type) {
    const el = document.getElementById('prediction-display');
    if (el) {
        el.textContent = text;
        // Simple color mapping
        let color = 'rgba(0,0,0,0.7)';
        if (type === 'success') color = 'rgba(16, 185, 129, 0.8)';
        if (type === 'warning') color = 'rgba(245, 158, 11, 0.8)';
        if (type === 'error') color = 'rgba(239, 68, 68, 0.8)';
        el.style.background = color;
    }
}

function showToast(msg, type='info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.className = 'toast', 3000);
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

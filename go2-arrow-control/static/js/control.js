// GO2 Control Page JavaScript

// State
let currentState = {
    inferenceActive: false,
    modelLoaded: false
};

let inferenceInterval = null;
const INFERENCE_FPS = 2;

document.addEventListener('DOMContentLoaded', () => {
    initializeWebcam();
    initializeControls();
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
    
    // Sliders
    const confSlider = document.getElementById('confidence-threshold');
    const speedSlider = document.getElementById('max-speed');
    const rateSlider = document.getElementById('command-rate');
    const bufSlider = document.getElementById('buffer-size');
    const conSlider = document.getElementById('consensus-req');

    confSlider.addEventListener('input', (e) => document.getElementById('confidence-value').textContent = e.target.value + '%');
    speedSlider.addEventListener('input', (e) => document.getElementById('speed-value').textContent = e.target.value);
    
    if(rateSlider) rateSlider.addEventListener('input', (e) => document.getElementById('rate-value').textContent = e.target.value);
    if(bufSlider) bufSlider.addEventListener('input', (e) => document.getElementById('buffer-value').textContent = e.target.value);
    if(conSlider) conSlider.addEventListener('input', (e) => document.getElementById('consensus-value').textContent = e.target.value);
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
            data.models.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.filename;
                // Add modification time
                const date = new Date(model.modified).toLocaleDateString();
                opt.textContent = `${model.name} (${date})`;
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

function stopInference() {
    currentState.inferenceActive = false;
    if (inferenceInterval) clearInterval(inferenceInterval);
    updateButtons();
    updateDisplay('Stopped', 'warning');
    
    fetch('/stop_inference', {
        method: 'POST'
    });
}

async function emergencyStop() {
    stopInference();
    await fetch('/emergency_stop', { method: 'POST' });
    showToast('EMERGENCY STOP TRIGGERED', 'error');
}

async function sendFrame() {
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
                if (data.inference_enabled) startInference(); // Basic sync
                else stopInference();
            }
            
        } catch (e) {}
    }, 2000);
}

// --- Helpers ---

function updateButtons() {
    document.getElementById('start-btn').disabled = !currentState.modelLoaded || currentState.inferenceActive;
    document.getElementById('stop-btn').disabled = !currentState.inferenceActive;
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

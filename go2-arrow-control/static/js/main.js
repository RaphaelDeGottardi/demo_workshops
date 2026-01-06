// GO2 Arrow Control - Main JavaScript

// State management
let currentState = {
    modelLoaded: false,
    robotConnected: false,
    inferenceActive: false,
    currentModel: null
};

// Webcam and inference management
let webcamStream = null;
let videoElement = null;
let canvasElement = null;
let inferenceInterval = null;
const INFERENCE_FPS = 2; // Send frames for inference 2 times per second (reduced)

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    videoElement = document.getElementById('webcam');
    canvasElement = document.getElementById('canvas');
    
    initializeEventListeners();
    initializeWebcam();
    loadModels();
    loadSettings();
    startStatusUpdates();
});

// Initialize Webcam
async function initializeWebcam() {
    try {
        const constraints = {
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        };
        
        webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = webcamStream;
        
        showToast('Camera ready! ✓', 'success');
        updatePredictionDisplay('Camera ready - waiting for model');
        
    } catch (error) {
        console.error('Camera error:', error);
        showToast('Camera access denied. Please allow camera access.', 'error');
        updatePredictionDisplay('Camera access denied');
    }
}

// Capture frame from webcam
function captureFrame() {
    if (!videoElement || !canvasElement) return null;
    
    const context = canvasElement.getContext('2d');
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    
    // Draw the video frame to canvas
    context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    
    // Get base64 encoded image
    return canvasElement.toDataURL('image/jpeg', 0.8);
}

// Send frame for inference
async function sendFrameForInference() {
    if (!currentState.inferenceActive) return;
    
    try {
        const frameData = captureFrame();
        if (!frameData) return;
        
        const response = await fetch('/predict_frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: frameData })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update prediction display
            const confidencePercent = (data.confidence * 100).toFixed(1);

            // Show consensus info when available
            if (data.most_common) {
                const cons = data.consensus_count || 0;
                const buf = data.buffer_size || 10;
                if (data.command_executed) {
                    updatePredictionDisplay(`${data.command_to_execute}: ${confidencePercent}% ✓ (${cons}/${buf})`, 'success');
                } else {
                    updatePredictionDisplay(`${data.most_common}: ${confidencePercent}% (${cons}/${buf} consensus) -> ${data.command_to_execute}`, 'warning');
                }
            } else {
                updatePredictionDisplay(`${data.prediction}: ${confidencePercent}%`, 'info');
            }
        } else {
            updatePredictionDisplay(data.error || 'Inference error', 'error');
        }
        
    } catch (error) {
        console.error('Inference error:', error);
        updatePredictionDisplay('Connection error', 'error');
    }
}

// Update prediction display
function updatePredictionDisplay(text, type = 'info') {
    const display = document.getElementById('prediction-display');
    display.textContent = text;
    
    // Update colors based on type
    display.style.background = type === 'success' ? 'rgba(16, 185, 129, 0.8)' :
                                type === 'warning' ? 'rgba(245, 158, 11, 0.8)' :
                                type === 'error' ? 'rgba(239, 68, 68, 0.8)' :
                                'rgba(0, 0, 0, 0.7)';
}

// Event Listeners
function initializeEventListeners() {
    // Upload form
    document.getElementById('upload-form').addEventListener('submit', handleUpload);
    
    // Control buttons
    document.getElementById('start-btn').addEventListener('click', startInference);
    document.getElementById('stop-btn').addEventListener('click', stopInference);
    document.getElementById('emergency-btn').addEventListener('click', emergencyStop);
    
    // Settings
    document.getElementById('confidence-threshold').addEventListener('input', updateConfidenceDisplay);
    document.getElementById('max-speed').addEventListener('input', updateSpeedDisplay);
    document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
}

// Upload Model
async function handleUpload(e) {
    e.preventDefault();
    
    const modelName = document.getElementById('model-name').value.trim();
    const modelFile = document.getElementById('model-file').files[0];
    
    if (!modelName || !modelFile) {
        showToast('Please provide both model name and file', 'error');
        return;
    }
    
    const formData = new FormData();
    formData.append('model', modelFile);
    formData.append('model_name', modelName);
    
    try {
        showToast('Uploading model...', 'info');
        
        const response = await fetch('/upload_model', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Model uploaded successfully! ✓', 'success');
            
            // Reset form
            document.getElementById('upload-form').reset();
            
            // Reload models list
            await loadModels();
        } else {
            showToast(`Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Upload failed: ${error.message}`, 'error');
    }
}

// Load Models List
async function loadModels() {
    const modelsList = document.getElementById('models-list');
    modelsList.innerHTML = '<p class="loading">Loading models...</p>';
    
    try {
        const response = await fetch('/models');
        const data = await response.json();
        
        if (data.models.length === 0) {
            modelsList.innerHTML = '<p class="loading">No models uploaded yet. Upload your first model above!</p>';
            return;
        }
        
        modelsList.innerHTML = '';
        
        data.models.forEach(model => {
            const modelItem = createModelItem(model, data.current);
            modelsList.appendChild(modelItem);
        });
        
    } catch (error) {
        modelsList.innerHTML = '<p class="loading">Error loading models</p>';
        console.error('Error loading models:', error);
    }
}

// Create Model Item Element
function createModelItem(model, currentModel) {
    const div = document.createElement('div');
    div.className = 'model-item';
    
    if (model.filename === currentModel) {
        div.classList.add('active');
    }
    
    const isActive = model.filename === currentModel;
    
    div.innerHTML = `
        <div class="model-info">
            <div class="model-name">${extractModelName(model.filename)}</div>
            <div class="model-meta">
                ${formatFileSize(model.size)} • 
                ${formatDate(model.modified)}
                ${isActive ? ' • <strong>Active</strong>' : ''}
            </div>
        </div>
        <div class="model-actions">
            <button class="btn btn-primary" onclick="loadModel('${model.filename}')" ${isActive ? 'disabled' : ''}>
                ${isActive ? '✓ Loaded' : 'Load'}
            </button>
            <button class="btn btn-danger" onclick="deleteModel('${model.filename}')" ${isActive ? 'disabled' : ''}>
                Delete
            </button>
        </div>
    `;
    
    return div;
}

// Load Model
async function loadModel(filename) {
    try {
        showToast('Loading model...', 'info');
        
        const response = await fetch('/load_model', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Model loaded successfully! ✓', 'success');
            if (data.warning && data.warning_message) {
                showToast(`Warning: ${data.warning_message}`, 'warning');
            }
            currentState.modelLoaded = true;
            await loadModels();
            updateControlButtons();
        } else {
            showToast(`Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Failed to load model: ${error.message}`, 'error');
    }
}

// Delete Model
async function deleteModel(filename) {
    if (!confirm(`Are you sure you want to delete "${extractModelName(filename)}"?`)) {
        return;
    }
    
    try {
        const response = await fetch('/delete_model', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Model deleted', 'success');
            await loadModels();
        } else {
            showToast(`Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Failed to delete model: ${error.message}`, 'error');
    }
}

// Start Inference
async function startInference() {
    try {
        showToast('Starting robot control...', 'info');
        
        const response = await fetch('/start_inference', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Robot control started! Show arrows to the camera 🎯', 'success');
            currentState.inferenceActive = true;
            updateControlButtons();
            
            // Start sending frames for inference
            if (inferenceInterval) {
                clearInterval(inferenceInterval);
            }
            inferenceInterval = setInterval(sendFrameForInference, 1000 / INFERENCE_FPS);
            
        } else {
            showToast(`Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Failed to start: ${error.message}`, 'error');
    }
}

// Stop Inference
async function stopInference() {
    try {
        const response = await fetch('/stop_inference', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Robot control stopped', 'warning');
            currentState.inferenceActive = false;
            updateControlButtons();
            
            // Stop sending frames
            if (inferenceInterval) {
                clearInterval(inferenceInterval);
                inferenceInterval = null;
            }
            
            updatePredictionDisplay('Control stopped');
            
        } else {
            showToast(`Error: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Failed to stop: ${error.message}`, 'error');
    }
}

// Emergency Stop
async function emergencyStop() {
    try {
        const response = await fetch('/emergency_stop', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('🛑 EMERGENCY STOP ACTIVATED', 'error');
            currentState.inferenceActive = false;
            updateControlButtons();
            
            // Stop sending frames
            if (inferenceInterval) {
                clearInterval(inferenceInterval);
                inferenceInterval = null;
            }
            
            updatePredictionDisplay('EMERGENCY STOP');
        }
    } catch (error) {
        showToast(`Emergency stop failed: ${error.message}`, 'error');
        
        // Still try to stop locally
        currentState.inferenceActive = false;
        if (inferenceInterval) {
            clearInterval(inferenceInterval);
            inferenceInterval = null;
        }
    }
}

// Load Settings
async function loadSettings() {
    try {
        const response = await fetch('/settings');
        const settings = await response.json();
        
        document.getElementById('confidence-threshold').value = settings.confidence_threshold * 100;
        document.getElementById('max-speed').value = settings.max_speed;
        
        updateConfidenceDisplay();
        updateSpeedDisplay();
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save Settings
async function saveSettings() {
    const confidenceThreshold = parseFloat(document.getElementById('confidence-threshold').value) / 100;
    const maxSpeed = parseFloat(document.getElementById('max-speed').value);
    
    try {
        const response = await fetch('/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                confidence_threshold: confidenceThreshold,
                max_speed: maxSpeed
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showToast('Settings saved ✓', 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch (error) {
        showToast(`Failed to save settings: ${error.message}`, 'error');
    }
}

// Update Display Values
function updateConfidenceDisplay() {
    const value = document.getElementById('confidence-threshold').value;
    document.getElementById('confidence-value').textContent = `${value}%`;
}

function updateSpeedDisplay() {
    const value = document.getElementById('max-speed').value;
    document.getElementById('speed-value').textContent = value;
}

// Update Status Bar
async function updateStatus() {
    try {
        const response = await fetch('/status');
        const status = await response.json();
        
        // Update model status
        const modelStatus = document.getElementById('model-status');
        if (status.model_loaded) {
            modelStatus.textContent = extractModelName(status.current_model || 'Unknown');
            modelStatus.style.background = 'rgba(16, 185, 129, 0.3)';
        } else {
            modelStatus.textContent = 'No model loaded';
            modelStatus.style.background = 'rgba(239, 68, 68, 0.3)';
        }
        
        // Update robot status
        const robotStatus = document.getElementById('robot-status');
        if (status.robot_connected) {
            robotStatus.textContent = 'Connected';
            robotStatus.style.background = 'rgba(16, 185, 129, 0.3)';
        } else {
            robotStatus.textContent = 'Disconnected';
            robotStatus.style.background = 'rgba(239, 68, 68, 0.3)';
        }
        
        // Update inference status
        const inferenceStatus = document.getElementById('inference-status');
        if (status.inference_enabled) {
            inferenceStatus.textContent = 'Active';
            inferenceStatus.style.background = 'rgba(16, 185, 129, 0.3)';
        } else {
            inferenceStatus.textContent = 'Stopped';
            inferenceStatus.style.background = 'rgba(148, 163, 184, 0.3)';
        }
        
        // Update state
        currentState.modelLoaded = status.model_loaded;
        currentState.robotConnected = status.robot_connected;
        currentState.inferenceActive = status.inference_enabled;
        currentState.currentModel = status.current_model;
        
        updateControlButtons();
        
    } catch (error) {
        console.error('Failed to update status:', error);
    }
}

// Update Control Buttons
function updateControlButtons() {
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    
    if (currentState.modelLoaded && !currentState.inferenceActive) {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    } else if (currentState.inferenceActive) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = true;
        stopBtn.disabled = true;
    }
}

// Start Status Updates
function startStatusUpdates() {
    updateStatus();
    setInterval(updateStatus, 2000); // Update every 2 seconds
}

// Utility Functions
function extractModelName(filename) {
    // Remove timestamp and extension
    return filename.replace(/_\d{8}_\d{6}\.tflite$/, '');
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

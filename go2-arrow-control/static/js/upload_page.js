// Setup Page JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initializeUploadForm();
    startLogPolling();
    loadModels();
    checkForErrors();
});

// --- Upload Logic ---
function initializeUploadForm() {
    const form = document.getElementById('upload-form');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const nameInput = document.getElementById('model-name');
        const fileInput = document.getElementById('model-file');
        const submitBtn = form.querySelector('button[type="submit"]');
        
        if (!nameInput.value || !fileInput.files[0]) {
            showToast('Please fill all fields', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('model_name', nameInput.value);
        formData.append('model', fileInput.files[0]);
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Uploading...';
        
        try {
            const response = await fetch('/upload_model', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showToast(`Model "${result.filename}" uploaded successfully!`, 'success');
                form.reset();
                loadModels(); // Refresh list after upload
            } else {
                showToast(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Upload Error:', error);
            showToast('Failed to upload model. See console.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '📤 Upload Model';
        }
    });
}

// --- Model Listing (Read Only) ---
async function loadModels() {
    const listElement = document.getElementById('models-list');
    
    try {
        const response = await fetch('/models');
        const data = await response.json();
        
        if (data.models && data.models.length > 0) {
            listElement.innerHTML = '';
            data.models.forEach(model => {
                const item = document.createElement('div');
                item.className = 'model-item';
                
                const date = new Date(model.modified).toLocaleString();
                
                item.innerHTML = `
                    <div class="model-info">
                        <span class="model-name">${escapeHtml(model.name)}</span>
                        <div class="model-meta">
                            <span>Cmds: Idle, Forward, Left, Right, Rotate</span><br>
                            <span>${(model.size / 1024).toFixed(1)} KB | ${date}</span>
                        </div>
                    </div>
                `;
                listElement.appendChild(item);
            });
        } else {
            listElement.innerHTML = '<p class="empty-message">No models uploaded yet.</p>';
        }
    } catch (error) {
        console.error('Error loading models:', error);
        listElement.innerHTML = '<p class="error-message">Failed to load models list</p>';
    }
}

// --- Log Polling Logic ---
function startLogPolling() {
    const logsArea = document.getElementById('logs-area');
    
    const fetchLogs = async () => {
        try {
            const response = await fetch('/logs');
            const data = await response.json();
            
            if (data.logs && Array.isArray(data.logs)) {
                if (data.logs.length === 0) {
                    logsArea.innerHTML = '<div class="log-entry">Waiting for events...</div>';
                } else {
                    logsArea.innerHTML = data.logs.map(line => 
                        `<div class="log-entry">${escapeHtml(line)}</div>`
                    ).join('');
                    logsArea.scrollTop = logsArea.scrollHeight;
                }
            }
        } catch (error) {
            console.error('Log fetch error:', error);
        }
    };
    
    // Poll every 2 seconds
    fetchLogs();
    setInterval(fetchLogs, 2000);
}

function checkForErrors() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    if (error) {
        showToast(error, 'error');
        window.history.replaceState({}, document.title, "/");
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

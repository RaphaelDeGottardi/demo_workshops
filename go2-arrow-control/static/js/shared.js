// Shared by the control page (control.js) and the maze simulator (sim.js).
// Needs vendor/tf.min.js and vendor/teachablemachine-image.min.js for loadBrowserModel().

const COMMAND_ARROWS = { Forward: '↑', Right: '→', Left: '←', Backwards: '↓', Idle: '⏸' };

// [bar colour, track colour] per class, same as the Teachable Machine preview
const CLASS_COLORS = [['#E67701', '#FFECE2'], ['#D84C6F', '#FFE9EC'], ['#794AEF', '#F1F0FF'], ['#1967D2', '#D2E3FC']];
let shownBarLabels = null;

// Teachable Machine's webcam has a "Flip" (mirror) setting, on by default. In workshop tests,
// left/right worked correctly with unmirrored frames, so the model gets the camera image as is.
const MIRROR_INPUT = false;
const PILOT_FRAME_SIZE = 240; // Square frames shared for the pilot view

// Predict on the webcam like the TM preview: centre square crop, scaled to [-1,1]
function predictWebcam(model, video) {
    return model.predict(video, MIRROR_INPUT);
}

// Teachable Machine TensorFlow.js model running in this browser (one at a time)
let loadedTmModel = null;
let loadedTmFilename = null;
let tmModelLoading = null;

// Load a model (info from /models) into this browser. Cached until another model is loaded.
async function loadBrowserModel(info) {
    if (!info) return null;
    if (loadedTmModel && loadedTmFilename === info.filename) return loadedTmModel;

    if (!tmModelLoading) {
        tmModelLoading = tmImage.load(info.model_url, info.metadata_url)
            .then(model => {
                loadedTmModel = model;
                loadedTmFilename = info.filename;
            })
            .finally(() => { tmModelLoading = null; });
    }
    await tmModelLoading;
    return loadedTmModel;
}

// Fill a <select> with models; duplicate names get the upload time to tell them apart
function fillModelSelect(select, models) {
    select.innerHTML = '<option value="">-- Choose a Model --</option>';

    const nameCounts = {};
    models.forEach(m => {
        nameCounts[m.name] = (nameCounts[m.name] || 0) + 1;
    });

    models.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model.filename;
        if (nameCounts[model.name] > 1) {
            const timeStr = new Date(model.modified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            opt.textContent = `${model.name} (${timeStr})`;
        } else {
            opt.textContent = model.name;
        }
        select.appendChild(opt);
    });
}

// Upload form (#upload-form, #model-name, #model-file). onUploaded(data) runs after a successful upload.
function initUploadForm(onUploaded) {
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
                const warnings = data.model && data.model.warnings.length;
                showToast(warnings ? 'Model uploaded, check the class names' : 'Model uploaded!', warnings ? 'warning' : 'success');
                form.reset();
                await onUploaded(data);
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

// Show one bar per class like the Teachable Machine preview (#class-output, #class-bars).
// probabilities may be null (all 0%).
function renderClassBars(labels, probabilities) {
    const panel = document.getElementById('class-output');
    if (!labels || !labels.length) {
        panel.style.display = 'none';
        shownBarLabels = null;
        return;
    }

    const container = document.getElementById('class-bars');
    // Rebuild the rows only when the classes change, then just update the widths
    if (JSON.stringify(labels) !== JSON.stringify(shownBarLabels)) {
        container.innerHTML = labels.map((label, i) => {
            const [color, track] = CLASS_COLORS[i % CLASS_COLORS.length];
            return `<div class="bar-graph-holder">
                <div class="bar-graph-label" style="color: ${color};">${escapeHtml(label)}</div>
                <div class="bar-graph" style="background-color: ${track};">
                    <div class="bar-graph-inner" style="background-color: ${color}; width: 0%;">
                        <span class="bar-graph-value">0%</span>
                    </div>
                </div>
            </div>`;
        }).join('');
        shownBarLabels = labels.slice();
    }

    container.querySelectorAll('.bar-graph-inner').forEach((bar, i) => {
        const percent = Math.round(100 * ((probabilities && probabilities[i]) || 0));
        bar.style.width = percent + '%';
        bar.firstElementChild.textContent = percent + '%';
    });
    panel.style.display = 'block';
}

// Table of class name -> robot move, plus mapping warnings (#model-mapping)
function renderModelMapping(info) {
    const el = document.getElementById('model-mapping');
    if (!info) {
        el.style.display = 'none';
        return;
    }

    const rows = info.labels.map((label, i) => {
        const cmd = info.commands[i];
        const cls = info.mapping_method === 'name' && !info.recognised[i] ? ' class="unmapped"' : '';
        return `<tr${cls}><td>${escapeHtml(label)}</td><td>→</td><td>${COMMAND_ARROWS[cmd] || ''} ${cmd}</td></tr>`;
    }).join('');
    const warnings = info.warnings.map(w => `<div class="mapping-warning">⚠️ ${escapeHtml(w)}</div>`).join('');

    el.innerHTML = `<strong>${escapeHtml(info.name)}</strong>: your classes → robot moves<table>${rows}</table>${warnings}`;
    el.style.display = 'block';
}

// Coloured status text over the camera image (#prediction-display)
function updateDisplay(text, type) {
    const el = document.getElementById('prediction-display');
    if (el) {
        el.textContent = text;
        let color = 'rgba(0,0,0,0.7)';
        if (type === 'success') color = 'rgba(16, 185, 129, 0.8)';
        if (type === 'warning') color = 'rgba(245, 158, 11, 0.8)';
        if (type === 'error') color = 'rgba(239, 68, 68, 0.8)';
        el.style.background = color;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg, type='info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.className = 'toast', 3000);
}

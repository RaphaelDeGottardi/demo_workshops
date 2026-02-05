"""
GO2 Arrow Control - Main Flask Server
Teachable Machine model upload and robot control system
"""

import os
import time
import json
import uuid
from flask import Flask, render_template, request, jsonify, Response, session, redirect, url_for
from werkzeug.utils import secure_filename
import base64
import threading
from collections import deque, Counter
from datetime import datetime
from io import BytesIO
import numpy as np
from PIL import Image

import logging
import sys

# Configure logging: control logs to stdout; HTTP logs to file
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
logs_dir = os.path.join(project_root, 'logs')
os.makedirs(logs_dir, exist_ok=True)

# Control logger (visible on stdout when running app.py)
control_logger = logging.getLogger('control')
control_logger.setLevel(logging.INFO)
ch = logging.StreamHandler(sys.stdout)
ch.setLevel(logging.INFO)
ch.setFormatter(logging.Formatter('%(asctime)s [CONTROL] %(levelname)s: %(message)s'))
control_logger.addHandler(ch)

# Add file handler for control logs
control_log_path = os.path.join(logs_dir, 'control.log')
fh = logging.FileHandler(control_log_path)
fh.setLevel(logging.INFO)
fh.setFormatter(logging.Formatter('%(asctime)s [CONTROL] %(levelname)s: %(message)s'))
control_logger.addHandler(fh)


def get_network_info():
    """Return a short summary of network addresses available on this host."""
    addrs = set()
    try:
        # outward-facing IP (best-effort)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('8.8.8.8', 80))
            addrs.add(s.getsockname()[0])
        finally:
            s.close()
    except Exception:
        pass

    try:
        # host name addresses
        host = socket.gethostname()
        for a in socket.getaddrinfo(host, None):
            ip = a[4][0]
            # skip IPv6 and loopback
            if ':' in ip or ip.startswith('127.'):
                continue
            addrs.add(ip)
    except Exception:
        pass

    # fallback: include localhost
    if not addrs:
        addrs.add('127.0.0.1')

    return sorted(addrs)


# HTTP / werkzeug logger goes to a separate file
http_log_path = os.path.join(logs_dir, 'http.log')
http_handler = logging.FileHandler(http_log_path)
http_handler.setLevel(logging.INFO)
http_handler.setFormatter(logging.Formatter('%(asctime)s [HTTP] %(levelname)s: %(message)s'))
werkzeug_logger = logging.getLogger('werkzeug')
for h in list(werkzeug_logger.handlers):
    werkzeug_logger.removeHandler(h)
werkzeug_logger.addHandler(http_handler)
werkzeug_logger.setLevel(logging.INFO)
werkzeug_logger.propagate = False

# Reduce root logger verbosity
logging.getLogger().setLevel(logging.WARNING)

from inference import ModelInference
from robot_controller import GO2Controller

app = Flask(__name__, static_folder='../static', template_folder='../static')

# Secret for teacher session (override with env var TEACHER_PASSWORD or TEACHER_SECRET)
app.secret_key = os.environ.get('TEACHER_SECRET', os.environ.get('TEACHER_PASSWORD', 'teacher_secret_key'))
TEACHER_PASSWORD = os.environ.get('TEACHER_PASSWORD', 'teacher123')

# Configuration
UPLOAD_FOLDER = 'uploads/models'
ALLOWED_EXTENSIONS = {'tflite'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# Global objects
inference_engine = None
robot_controller = None
current_model_name = None
is_running = False
last_command_time = 0
COMMAND_TIMEOUT = 2.0  # Stop if no detection for 2 seconds
last_command_sent_time = 0

# Concurrency & Pilot control
current_pilot = None  # Stores the session user_id of the person currently in control
pilot_lock = threading.Lock()
pilot_last_active = 0 # To detect if a pilot has disconnected
system_locked = False # Teacher can lock the system to prevent any control

# Prediction buffering for consensus
PREDICTION_BUFFER = None
PREDICTION_BUFFER_LOCK = threading.Lock()
LAST_SENT_COMMAND_NAME = None
LAST_PILOT_FRAME = None # Stores the last frame sent by the pilot for others to see

# Settings
settings = {
    'confidence_threshold': 0.65,
    'max_speed': 0.3,
    'inference_enabled': False
}

# Command rate and consensus settings
settings.setdefault('command_interval', 0.2)
settings.setdefault('buffer_size', 3)
settings.setdefault('consensus_required', 2)


def is_current_pilot():
    """Helper to check if the current user is the pilot"""
    global current_pilot
    user_id = session.get('user_id')
    if not user_id:
        return False
    
    with pilot_lock:
        return current_pilot is not None and current_pilot == user_id


def stop_robot_and_inference():
    """Helper to stop both inference and the robot movement"""
    global robot_controller
    settings['inference_enabled'] = False
    if robot_controller and robot_controller.connected:
        robot_controller.stop()
    control_logger.info("Inference stopped and robot idling.")


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.before_request
def ensure_user_id():
    if 'user_id' not in session:
        session['user_id'] = str(uuid.uuid4())


@app.route('/')
def index():
    """Serve control page as the landing page"""
    return render_template('control.html')


@app.route('/control')
def control_page():
    """Redirect to home"""
    return redirect(url_for('index'))


@app.route('/docs')
def documentation():
    """Serve documentation page"""
    return render_template('documentation.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Teacher login only"""
    if request.method == 'GET':
        return render_template('login.html') # Need to create this simple login page

    password = request.form.get('password', '')
    if password == TEACHER_PASSWORD:
        session['is_teacher'] = True
        return redirect(url_for('teacher_page'))
    else:
        return redirect(url_for('login', error='Invalid Teacher Password'))


@app.route('/logout')
def logout():
    session.pop('authenticated', None)
    session.pop('is_teacher', None)
    return redirect(url_for('index'))


@app.route('/teacher')
def teacher_page():
    """Teacher management page"""
    if not session.get('is_teacher'):
        return redirect(url_for('login'))
    return render_template('teacher.html')


@app.route('/api/control_status', methods=['GET'])
def control_status():
    """Get current pilot status"""
    global current_pilot, system_locked
    
    return jsonify({
        'current_pilot': current_pilot,
        'is_pilot': session.get('user_id') == current_pilot,
        'user_id': session.get('user_id'),
        'system_locked': system_locked
    })


@app.route('/api/take_control', methods=['POST'])
def take_control():
    """Attempt to take control of the robot"""
    global current_pilot, system_locked
    
    if system_locked and not session.get('is_teacher'):
        return jsonify({'success': False, 'message': 'System is currently locked by teacher'}), 403

    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'No session ID'}), 400

    with pilot_lock:
        # Check if already controlled by someone else
        if current_pilot and current_pilot != user_id:
            return jsonify({'success': False, 'message': 'Robot is currently controlled by another student'}), 409
            
        current_pilot = user_id
        control_logger.info(f"User {user_id} took control")
        
    return jsonify({'success': True, 'message': 'You now have control'})


@app.route('/api/relinquish_control', methods=['POST'])
def relinquish_control():
    """Release control of the robot"""
    global current_pilot
    
    user_id = session.get('user_id')
    with pilot_lock:
        if current_pilot == user_id:
            current_pilot = None
            stop_robot_and_inference()
            control_logger.info(f"User {user_id} relinquished control")
            
    return jsonify({'success': True})


@app.route('/api/teacher/reset_control', methods=['POST'])
def teacher_reset_control():
    """Teacher force-resets control"""
    global current_pilot
    if not session.get('is_teacher'):
        return jsonify({'error': 'Unauthorized'}), 403
    
    with pilot_lock:
        current_pilot = None
        stop_robot_and_inference()
        control_logger.info("Teacher reset control")
        
    return jsonify({'success': True})


@app.route('/api/teacher/lock_system', methods=['POST'])
def teacher_lock_system():
    """Teacher locks the system"""
    global system_locked, current_pilot
    if not session.get('is_teacher'):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    system_locked = data.get('locked', True)
    
    if system_locked:
        with pilot_lock:
            current_pilot = None  # Boot current pilot
            stop_robot_and_inference()
        control_logger.info("Teacher LOCKED the system")
    else:
        control_logger.info("Teacher UNLOCKED the system")
        
    return jsonify({'success': True, 'locked': system_locked})


@app.route('/api/pilot_frame', methods=['GET'])
def get_pilot_frame():
    """Get the last frame sent by the current pilot"""
    if LAST_PILOT_FRAME:
        return jsonify({'image': LAST_PILOT_FRAME})
    return jsonify({'image': None})


@app.route('/logs')
def get_logs():
    """Get filtered control logs (Uploads and Commands only)"""
    try:
        control_log_path = os.path.join(logs_dir, 'control.log')
        if not os.path.exists(control_log_path):
            return jsonify({'logs': []})
            
        # Read file and filter
        filtered_logs = []
        with open(control_log_path, 'r') as f:
            for line in f:
                # Filter for useful events
                if any(x in line for x in ['Uploaded model:', 'Command:', 'Moving', 'Turning', 'Rotating', 'Idle', 'Prediction']):
                    filtered_logs.append(line)
        
        # Return last 50 matches
        return jsonify({'logs': filtered_logs[-50:]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/predict_frame', methods=['POST'])
def predict_frame():
    """
    Accept an image frame from the browser and return prediction
    Expects: JSON with base64 encoded image
    Returns: JSON with prediction, confidence, and command
    """
    global last_command_time, pilot_last_active, LAST_PILOT_FRAME
    
    # Check if this user is the current pilot
    if not is_current_pilot():
        return jsonify({'error': 'Not the current pilot'}), 403
    
    try:
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({'error': 'No image provided'}), 400

        # Store as last pilot frame
        global LAST_PILOT_FRAME, pilot_last_active
        LAST_PILOT_FRAME = data['image'] # Already base64 encoded
        pilot_last_active = time.time()

        # Decode base64 image
        image_data = data['image'].split(',')[1]  # Remove data:image/jpeg;base64, prefix
        image_bytes = base64.b64decode(image_data)

        # Convert to numpy array
        image = Image.open(BytesIO(image_bytes))
        image_np = np.array(image)

        # Convert RGB to BGR for OpenCV compatibility
        if len(image_np.shape) == 3 and image_np.shape[2] == 3:
            image_np = image_np[:, :, ::-1]  # RGB to BGR

        # Ensure prediction buffer initialized
        global PREDICTION_BUFFER
        if PREDICTION_BUFFER is None:
            with PREDICTION_BUFFER_LOCK:
                if PREDICTION_BUFFER is None:
                    PREDICTION_BUFFER = deque(maxlen=int(settings.get('buffer_size', 10)))

        # Run inference if model is loaded and inference is enabled
        if not (inference_engine and inference_engine.model_loaded and settings['inference_enabled']):
            return jsonify({
                'error': 'Inference not enabled or no model loaded',
                'model_loaded': inference_engine is not None and inference_engine.model_loaded,
                'inference_enabled': settings['inference_enabled']
            }), 400

        prediction, confidence = inference_engine.predict(image_np)

        # Append prediction to buffer
        with PREDICTION_BUFFER_LOCK:
            PREDICTION_BUFFER.append(prediction)
            buffer_snapshot = list(PREDICTION_BUFFER)

        # Decide consensus only when buffer is full
        command_to_execute = 'Idle'
        consensus_count = 0
        most_common = None
        if len(buffer_snapshot) >= int(settings.get('buffer_size', 10)):
            counts = Counter(buffer_snapshot)
            most_common, count = counts.most_common(1)[0]
            consensus_count = int(count)
            # Require that most_common is not 'Idle' and meets consensus_required
            if most_common.lower() != 'idle' and count >= int(settings.get('consensus_required', 7)):
                command_to_execute = most_common
            else:
                command_to_execute = 'Idle'

        # Enforce confidence threshold for the latest frame before counting it as valid
        frame_valid = confidence >= settings.get('confidence_threshold', 0.8)

        # Rate-control: only send commands at most once per command_interval
        global last_command_sent_time, last_command_time, LAST_SENT_COMMAND_NAME
        now = time.time()
        command_executed = False

        time_since_last = now - last_command_time if last_command_time > 0 else 0

        if command_to_execute != 'Idle' and frame_valid:
            # Enough consensus to move — check rate limit
            interval = float(settings.get('command_interval', 0.5))
            if now - last_command_sent_time >= interval:
                if robot_controller and robot_controller.connected:
                    robot_controller.execute_command(command_to_execute, settings['max_speed'])
                    command_executed = True
                    last_command_sent_time = now
                    last_command_time = now
                    # record last sent command name to avoid repeated idle stops
                    LAST_SENT_COMMAND_NAME = command_to_execute
        else:
            # Not enough consensus — ensure robot is stopped
            if robot_controller and robot_controller.connected:
                # Only send stop/idle if last sent command was a movement (not already idle)
                if LAST_SENT_COMMAND_NAME is not None and LAST_SENT_COMMAND_NAME.lower() != 'idle':
                    robot_controller.stop()
                    LAST_SENT_COMMAND_NAME = 'Idle'
                last_command_time = now

        # Check for timeout (existing behavior)
        time_since_last = time.time() - last_command_time if last_command_time > 0 else 0
        if time_since_last > COMMAND_TIMEOUT and last_command_time > 0:
            if robot_controller and robot_controller.connected:
                # Only send stop if we previously sent a movement command
                if LAST_SENT_COMMAND_NAME is not None and LAST_SENT_COMMAND_NAME.lower() != 'idle':
                    robot_controller.stop()
                    LAST_SENT_COMMAND_NAME = 'Idle'

        return jsonify({
            'prediction': prediction,
            'confidence': float(confidence),
            'threshold': settings['confidence_threshold'],
            'buffer_size': int(settings.get('buffer_size', 10)),
            'consensus_required': int(settings.get('consensus_required', 7)),
            'buffer_snapshot': buffer_snapshot,
            'most_common': most_common if len(buffer_snapshot) > 0 else None,
            'consensus_count': consensus_count,
            'command_to_execute': command_to_execute,
            'command_executed': command_executed,
            'time_since_last': time_since_last
        })
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/upload_model', methods=['POST'])
def upload_model():
    """Upload a new TFLite model"""
    if 'model' not in request.files:
        return jsonify({'error': 'No model file provided'}), 400
    
    file = request.files['model']
    model_name = request.form.get('model_name', '').strip()
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not model_name:
        return jsonify({'error': 'Model name is required'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Only .tflite files are allowed'}), 400
    
    try:
        # Create filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_name = secure_filename(model_name)
        filename = f"{safe_name}_{timestamp}.tflite"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        file.save(filepath)
        
        control_logger.info("Uploaded model: %s (%s)", model_name, filename)

        # Create a default labels file if none provided by the user.
        labels_path = filepath.replace('.tflite', '_labels.txt')
        if not os.path.exists(labels_path):
            try:
                default_labels = ['Forward', 'Right', 'Left', 'Rotate', 'Idle']
                with open(labels_path, 'w') as lf:
                    for lbl in default_labels:
                        lf.write(f"{lbl}\n")
                control_logger.info("Created default labels file at: %s", labels_path)
            except Exception as e:
                control_logger.warning("Could not create labels file: %s", e)
        
        return jsonify({
            'success': True,
            'message': 'Model uploaded successfully',
            'filename': filename,
            'model_name': model_name
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/models', methods=['GET'])
def list_models():
    """List all uploaded models"""
    try:
        models = []
        if os.path.exists(app.config['UPLOAD_FOLDER']):
            for filename in os.listdir(app.config['UPLOAD_FOLDER']):
                if filename.endswith('.tflite'):
                    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    models.append({
                        'filename': filename,
                        'name': filename.split('_')[0] if '_' in filename else filename,
                        'size': os.path.getsize(filepath),
                        'modified': datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()
                    })
        
        models.sort(key=lambda x: x['modified'], reverse=True)
        return jsonify({'models': models, 'current': current_model_name})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/load_model', methods=['POST'])
def load_model():
    """Load a specific model for inference"""
    global inference_engine, current_model_name
    
    if not is_current_pilot():
        return jsonify({'error': 'Not the current pilot'}), 403

    filename = request.form.get('filename')
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
        
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'Model file not found'}), 404
        
    try:
        if inference_engine is None:
            inference_engine = ModelInference()
            
        inference_engine.load_model(filepath)
        current_model_name = filename
        
        control_logger.info("Loaded model: %s", filename)
        
        return jsonify({'success': True, 'message': f"Loaded model: {filename}"})
    except Exception as e:
        control_logger.error("Failed to load model: %s", e)
        return jsonify({'error': str(e)}), 500




@app.route('/delete_model', methods=['POST'])
def delete_model():
    """Delete a model"""
    global current_model_name, inference_engine
    
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Model file not found'}), 404
    
    try:
        # Unload if it's the current model
        if current_model_name == filename:
            if inference_engine:
                inference_engine.unload_model()
            current_model_name = None
        
        os.remove(filepath)
        
        return jsonify({
            'success': True,
            'message': f'Model {filename} deleted successfully'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/start_inference', methods=['POST'])
def start_inference():
    """Start inference and robot control"""
    global robot_controller
    
    if not is_current_pilot():
        return jsonify({'error': 'Not the current pilot'}), 403

    if not inference_engine or not inference_engine.model_loaded:
        return jsonify({'error': 'No model loaded'}), 400
    
    try:
        # Initialize robot controller if not exists
        if robot_controller is None:
            robot_controller = GO2Controller()
        
        if not robot_controller.connected:
            robot_controller.connect()
        
        settings['inference_enabled'] = True
        
        return jsonify({
            'success': True,
            'message': 'Inference started',
            'robot_connected': robot_controller.connected
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/stop_inference', methods=['POST'])
def stop_inference():
    """Stop inference and robot"""
    if not is_current_pilot():
        return jsonify({'error': 'Not the current pilot'}), 403

    settings['inference_enabled'] = False
    
    if robot_controller and robot_controller.connected:
        robot_controller.stop()
    
    return jsonify({'success': True, 'message': 'Inference stopped'})


@app.route('/emergency_stop', methods=['POST'])
def emergency_stop():
    """Emergency stop - immediately stop robot"""
    if not is_current_pilot():
        return jsonify({'error': 'Not the current pilot'}), 403

    settings['inference_enabled'] = False
    
    if robot_controller and robot_controller.connected:
        robot_controller.emergency_stop()
    
    return jsonify({'success': True, 'message': 'Emergency stop activated'})


@app.route('/settings', methods=['GET', 'POST'])
def manage_settings():
    """Get or update settings"""
    if request.method == 'POST':
        if not is_current_pilot():
            return jsonify({'error': 'Not the current pilot'}), 403
            
        data = request.get_json()
        
        # Core parameters
        if 'confidence_threshold' in data:
            settings['confidence_threshold'] = float(data['confidence_threshold'])
        
        if 'max_speed' in data:
            settings['max_speed'] = float(data['max_speed'])

        # Advanced parameters
        if 'command_interval' in data:
            settings['command_interval'] = float(data['command_interval'])
            
        if 'buffer_size' in data:
            settings['buffer_size'] = int(data['buffer_size'])
            
        if 'consensus_required' in data:
            settings['consensus_required'] = int(data['consensus_required'])
        
        return jsonify({'success': True, 'settings': settings})
    
    return jsonify(settings)


@app.route('/status', methods=['GET'])
def get_status():
    """Get system status"""
    global last_command_time, robot_controller, LAST_SENT_COMMAND_NAME
    
    # Background safety check: if no command for a while, stop robot
    now = time.time()
    if last_command_time > 0 and (now - last_command_time > COMMAND_TIMEOUT):
        if robot_controller and robot_controller.connected:
            if LAST_SENT_COMMAND_NAME is not None and LAST_SENT_COMMAND_NAME.lower() != 'idle':
                robot_controller.stop()
                LAST_SENT_COMMAND_NAME = 'Idle'
                control_logger.info("Safety timeout: Robot stopped due to inactivity")

    return jsonify({
        'inference_enabled': settings['inference_enabled'],
        'model_loaded': inference_engine is not None and inference_engine.model_loaded,
        'current_model': current_model_name,
        'robot_connected': robot_controller is not None and robot_controller.connected,
        'settings': settings
    })


if __name__ == '__main__':
    control_logger.info("%s", "=" * 60)
    control_logger.info("GO2 Arrow Control System Starting...")
    control_logger.info("%s", "=" * 60)
    control_logger.info("Server will be available at: https://0.0.0.0:5000")
    control_logger.info("Models will be saved to: %s", os.path.abspath(UPLOAD_FOLDER))
    # Log detected network addresses
    try:
        import socket
        ips = get_network_info()
        for ip in ips:
            control_logger.info("Accessible at: https://%s:5000", ip)
    except Exception as e:
        control_logger.warning("Could not determine network interfaces: %s", e)
    control_logger.info("%s", "=" * 60)

    control_logger.info("Access the server via HTTPS to enable camera permissions.")
    control_logger.info("Accept the security warning in your browser (Advanced -> Proceed).")
    
    # Run with ad-hoc SSL context to allow camera access over network
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True, ssl_context='adhoc')

"""
GO2 Arrow Control - Main Flask Server
Teachable Machine model upload and robot control system
"""

import os
import time
import json
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
app.secret_key = os.environ.get('TEACHER_SECRET', os.environ.get('TEACHER_PASSWORD', 'change_this_teacher_password'))

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

# Prediction buffering for consensus
PREDICTION_BUFFER = None
PREDICTION_BUFFER_LOCK = threading.Lock()
LAST_SENT_COMMAND_NAME = None

# Settings
settings = {
    'confidence_threshold': 0.80,
    'max_speed': 0.3,  # Start slow for safety
    'inference_enabled': False
}

# Command rate and consensus settings
settings.setdefault('command_interval', 1.0)  # seconds between commands (slower default)
settings.setdefault('buffer_size', 10)
settings.setdefault('consensus_required', 7)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    """Serve main page"""
    return render_template('index.html')


@app.route('/predict_frame', methods=['POST'])
def predict_frame():
    """
    Accept an image frame from the browser and return prediction
    Expects: JSON with base64 encoded image
    Returns: JSON with prediction, confidence, and command
    """
    global last_command_time
    
    try:
        data = request.get_json()

        if not data or 'image' not in data:
            return jsonify({'error': 'No image provided'}), 400

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
    
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Model file not found'}), 404
    
    try:
        # Initialize inference engine if not exists
        if inference_engine is None:
            inference_engine = ModelInference()
        
        # Load the model
        inference_engine.load_model(filepath)
        current_model_name = filename
        
        response = {
            'success': True,
            'message': f'Model {filename} loaded successfully',
            'classes': inference_engine.get_classes()
        }

        # If there is a class/label mismatch, include a warning for the UI
        if hasattr(inference_engine, 'class_mismatch') and inference_engine.class_mismatch:
            response['warning'] = True
            response['warning_message'] = inference_engine.mismatch_message

        return jsonify(response)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/teacher', methods=['GET', 'POST'])
def teacher_login():
    """Teacher login page (GET) and login handler (POST).
    Password is read from env var `TEACHER_PASSWORD` (default: 'teacher').
    """
    if request.method == 'GET':
        return render_template('teacher_login.html')

    # POST: attempt login
    password = request.form.get('password', '')
    expected = os.environ.get('TEACHER_PASSWORD', 'teacher')
    if password == expected:
        session['teacher_authenticated'] = True
        return redirect(url_for('teacher_dashboard'))
    else:
        return render_template('teacher_login.html', error='Invalid password')


@app.route('/teacher/dashboard', methods=['GET'])
def teacher_dashboard():
    if not session.get('teacher_authenticated'):
        return redirect(url_for('teacher_login'))

    # Provide current settings to the teacher dashboard
    current = {
        'confidence_threshold': settings.get('confidence_threshold'),
        'max_speed': settings.get('max_speed'),
        'command_interval': settings.get('command_interval', 0.5),
        'buffer_size': settings.get('buffer_size', 10),
        'consensus_required': settings.get('consensus_required', 7)
    }

    return render_template('teacher_dashboard.html', settings=current)


@app.route('/teacher/update_settings', methods=['POST'])
def teacher_update_settings():
    if not session.get('teacher_authenticated'):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.form or request.get_json() or {}
    try:
        if 'confidence_threshold' in data:
            settings['confidence_threshold'] = float(data.get('confidence_threshold'))
        if 'max_speed' in data:
            settings['max_speed'] = float(data.get('max_speed'))
        if 'command_interval' in data:
            settings['command_interval'] = float(data.get('command_interval'))
        if 'buffer_size' in data:
            settings['buffer_size'] = int(data.get('buffer_size'))
        if 'consensus_required' in data:
            settings['consensus_required'] = int(data.get('consensus_required'))

        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/teacher/logout')
def teacher_logout():
    session.pop('teacher_authenticated', None)
    return redirect(url_for('index'))

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
    settings['inference_enabled'] = False
    
    if robot_controller and robot_controller.connected:
        robot_controller.stop()
    
    return jsonify({'success': True, 'message': 'Inference stopped'})


@app.route('/emergency_stop', methods=['POST'])
def emergency_stop():
    """Emergency stop - immediately stop robot"""
    settings['inference_enabled'] = False
    
    if robot_controller and robot_controller.connected:
        robot_controller.emergency_stop()
    
    return jsonify({'success': True, 'message': 'Emergency stop activated'})


@app.route('/settings', methods=['GET', 'POST'])
def manage_settings():
    """Get or update settings"""
    if request.method == 'POST':
        data = request.get_json()
        
        if 'confidence_threshold' in data:
            settings['confidence_threshold'] = float(data['confidence_threshold'])
        
        if 'max_speed' in data:
            settings['max_speed'] = float(data['max_speed'])
        
        return jsonify({'success': True, 'settings': settings})
    
    return jsonify(settings)


@app.route('/status', methods=['GET'])
def get_status():
    """Get system status"""
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
    control_logger.info("Server will be available at: http://0.0.0.0:5000")
    control_logger.info("Models will be saved to: %s", os.path.abspath(UPLOAD_FOLDER))
    # Log detected network addresses
    try:
        import socket
        ips = get_network_info()
        for ip in ips:
            control_logger.info("Accessible at: http://%s:5000", ip)
    except Exception as e:
        control_logger.warning("Could not determine network interfaces: %s", e)
    control_logger.info("%s", "=" * 60)

    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)

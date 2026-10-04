"""
GO2 Arrow Control - Main Flask Server
Teachable Machine model upload and robot control system
"""

import os
import re
import time
import json
import uuid
import shutil
import zipfile
import unicodedata
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    session,
    redirect,
    url_for,
    send_from_directory,
    abort,
)
from werkzeug.utils import secure_filename
import threading
from collections import deque, Counter
from datetime import datetime
from io import BytesIO

import logging
import sys

# Configure logging: control logs to stdout; HTTP logs to file
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
logs_dir = os.path.join(project_root, "logs")
os.makedirs(logs_dir, exist_ok=True)

# Control logger (visible on stdout when running app.py)
control_logger = logging.getLogger("control")
control_logger.setLevel(logging.INFO)
ch = logging.StreamHandler(sys.stdout)
ch.setLevel(logging.INFO)
ch.setFormatter(logging.Formatter("%(asctime)s [CONTROL] %(levelname)s: %(message)s"))
control_logger.addHandler(ch)

# Add file handler for control logs
control_log_path = os.path.join(logs_dir, "control.log")
fh = logging.FileHandler(control_log_path)
fh.setLevel(logging.INFO)
fh.setFormatter(logging.Formatter("%(asctime)s [CONTROL] %(levelname)s: %(message)s"))
control_logger.addHandler(fh)


def get_network_info():
    """Return a short summary of network addresses available on this host."""
    addrs = set()
    try:
        # outward-facing IP (best-effort)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
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
            if ":" in ip or ip.startswith("127."):
                continue
            addrs.add(ip)
    except Exception:
        pass

    # fallback: include localhost
    if not addrs:
        addrs.add("127.0.0.1")

    return sorted(addrs)


# HTTP / werkzeug logger goes to a separate file
http_log_path = os.path.join(logs_dir, "http.log")
http_handler = logging.FileHandler(http_log_path)
http_handler.setLevel(logging.INFO)
http_handler.setFormatter(
    logging.Formatter("%(asctime)s [HTTP] %(levelname)s: %(message)s")
)
werkzeug_logger = logging.getLogger("werkzeug")
for h in list(werkzeug_logger.handlers):
    werkzeug_logger.removeHandler(h)
werkzeug_logger.addHandler(http_handler)
werkzeug_logger.setLevel(logging.INFO)
werkzeug_logger.propagate = False

# Reduce root logger verbosity
logging.getLogger().setLevel(logging.WARNING)

from robot_controller import GO2Controller

app = Flask(__name__, static_folder="../static", template_folder="../static")

# Secret for teacher session (override with env var TEACHER_PASSWORD or TEACHER_SECRET)
app.secret_key = os.environ.get(
    "TEACHER_SECRET", os.environ.get("TEACHER_PASSWORD", "teacher_secret_key")
)
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "teacher123")

# Configuration
UPLOAD_FOLDER = "uploads/models"
ALLOWED_EXTENSIONS = {"zip"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Robot commands, in the legacy class order used when class names can't be matched
COMMANDS = ["Forward", "Right", "Left", "Backwards", "Idle"]

# Teachable Machine class names (normalised: lowercase, no accents) -> robot command
LABEL_SYNONYMS = {
    "Forward": {"forward", "forwards", "vorwarts", "vorwaerts", "vor", "vorne",
                "geradeaus", "up", "straight", "go", "↑"},
    "Right": {"right", "rechts", "→"},
    "Left": {"left", "links", "←"},
    "Backwards": {"backwards", "backward", "back", "reverse", "ruckwarts",
                  "rueckwaerts", "zuruck", "zurueck", "down", "sit", "↓"},
    "Idle": {"idle", "nothing", "none", "background", "stop", "nichts",
             "hintergrund", "leer", "neutral", "pause"},
}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE

# Global objects
robot_controller = None
current_model_name = None
current_model_info = None  # get_model_info() of the loaded model (labels, commands, type)
is_running = False
last_command_time = 0
COMMAND_TIMEOUT = 2.0  # Stop if no detection for 2 seconds
last_command_sent_time = 0

# Concurrency & Pilot control
current_pilot = None  # Stores the session user_id of the person currently in control
pilot_lock = threading.Lock()
pilot_last_active = 0  # To detect if a pilot has disconnected
PILOT_INACTIVITY_TIMEOUT = 90.0  # Auto-release pilot after inactivity
system_locked = False  # Teacher can lock the system to prevent any control

# Prediction buffering for consensus
PREDICTION_BUFFER = None
PREDICTION_BUFFER_LOCK = threading.Lock()
LAST_SENT_COMMAND_NAME = None
LAST_PILOT_FRAME = None  # Stores the last frame sent by the pilot for others to see
LAST_PREDICTION_DATA = None  # Stores prediction info for others to see

# Settings (max_speed 0.5 = the forward speed tuned at the first workshop)
settings = {"confidence_threshold": 0.65, "max_speed": 0.5, "inference_enabled": False}

# Command rate and consensus settings
settings.setdefault("command_interval", 0.2)
settings.setdefault("buffer_size", 3)
settings.setdefault("consensus_required", 2)

# Server-side bounds for runtime safety settings
SETTINGS_LIMITS = {
    "confidence_threshold": (0.30, 0.95),
    "max_speed": (0.10, 0.50),
    "command_interval": (0.02, 1.00),
    "buffer_size": (1, 16),
}


def validate_settings_payload(data):
    """Validate and normalize incoming settings updates."""
    validated = {}
    errors = []

    if not isinstance(data, dict):
        return validated, ["Request body must be a JSON object"]

    def validate_float(name):
        if name not in data:
            return
        lo, hi = SETTINGS_LIMITS[name]
        try:
            value = float(data[name])
        except (TypeError, ValueError):
            errors.append(f"{name} must be a number")
            return
        if value < lo or value > hi:
            errors.append(f"{name} must be between {lo} and {hi}")
            return
        validated[name] = value

    def validate_int(name):
        if name not in data:
            return
        lo, hi = SETTINGS_LIMITS[name]
        try:
            value = int(data[name])
        except (TypeError, ValueError):
            errors.append(f"{name} must be an integer")
            return
        if value < lo or value > hi:
            errors.append(f"{name} must be between {lo} and {hi}")
            return
        validated[name] = value

    validate_float("confidence_threshold")
    validate_float("max_speed")
    validate_float("command_interval")
    validate_int("buffer_size")

    if "consensus_required" in data:
        try:
            consensus = int(data["consensus_required"])
        except (TypeError, ValueError):
            errors.append("consensus_required must be an integer")
            consensus = None

        if consensus is not None:
            target_buffer = validated.get(
                "buffer_size", int(settings.get("buffer_size", 3))
            )
            if consensus < 1 or consensus > target_buffer:
                errors.append(
                    f"consensus_required must be between 1 and {target_buffer}"
                )
            else:
                validated["consensus_required"] = consensus

    return validated, errors


def reconfigure_prediction_buffer(new_size):
    """Resize the live prediction buffer while preserving recent entries."""
    global PREDICTION_BUFFER
    with PREDICTION_BUFFER_LOCK:
        existing = list(PREDICTION_BUFFER) if PREDICTION_BUFFER is not None else []
        PREDICTION_BUFFER = deque(existing[-new_size:], maxlen=new_size)


def is_current_pilot():
    """Helper to check if the current user is the pilot"""
    global current_pilot
    user_id = session.get("user_id")
    if not user_id:
        return False

    with pilot_lock:
        return current_pilot is not None and current_pilot == user_id


def is_teacher():
    """Helper to check if the current user is a teacher"""
    return session.get("is_teacher") is True


def expire_stale_pilot():
    """Auto-release pilot if their session appears disconnected/inactive."""
    global current_pilot, pilot_last_active

    stale_pilot = None
    idle_for = 0.0
    now = time.time()

    with pilot_lock:
        if current_pilot is None or pilot_last_active <= 0:
            return

        idle_for = now - pilot_last_active
        if idle_for <= PILOT_INACTIVITY_TIMEOUT:
            return

        stale_pilot = current_pilot
        current_pilot = None
        pilot_last_active = 0

    stop_robot_and_inference()
    control_logger.warning(
        "Released stale pilot %s after %.1fs of inactivity", stale_pilot, idle_for
    )


def stop_robot_and_inference():
    """Helper to stop both inference and the robot movement"""
    global robot_controller
    settings["inference_enabled"] = False
    if robot_controller and robot_controller.connected:
        robot_controller.stop()
    control_logger.info("Inference stopped and robot idling.")


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# --- Class name -> robot command mapping ---


def normalize_label(label):
    """Lowercase and strip accents, e.g. 'Rückwärts' -> 'ruckwarts'."""
    decomposed = unicodedata.normalize("NFKD", str(label))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def match_label(label):
    """Return the robot command for a class name, or None if it isn't recognised."""
    norm = normalize_label(label)
    for command, synonyms in LABEL_SYNONYMS.items():
        if norm in synonyms:
            return command

    # Fall back to single words, e.g. "Arrow left" or "Forward ↑"
    found = set()
    for token in re.findall(r"[a-z]+|[↑↓←→]", norm):
        for command, synonyms in LABEL_SYNONYMS.items():
            if token in synonyms:
                found.add(command)
    return found.pop() if len(found) == 1 else None


def map_labels(labels):
    """Map class names to robot commands.

    Returns (commands, recognised, warnings, method): commands[i] is the command for
    class i (unrecognised classes become Idle), recognised[i] says whether the name
    matched.
    """
    matched = [match_label(lbl) for lbl in labels]
    warnings = []

    if not any(matched) and len(labels) == len(COMMANDS):
        warnings.append(
            "None of the class names were recognised, so the class order is used: "
            + ", ".join(COMMANDS) + "."
        )
        return list(COMMANDS), [False] * len(labels), warnings, "order"

    for lbl, cmd in zip(labels, matched):
        if cmd is None:
            warnings.append(f"Class '{lbl}' was not recognised and is treated as Idle (no movement).")
    for cmd in COMMANDS[:-1]:
        if cmd not in matched:
            warnings.append(f"No class for {cmd}, so the robot can't do that move.")

    commands = [cmd or "Idle" for cmd in matched]
    return commands, [cmd is not None for cmd in matched], warnings, "name"


# --- Model storage ---
# Each model is a Teachable Machine TensorFlow.js export, extracted to
# UPLOAD_FOLDER/<name>_<ts>/ (model.json, metadata.json, weights.bin). It runs in the browser.


def save_uploaded_model(file, base_name):
    """Extract an uploaded Teachable Machine TensorFlow.js .zip. Returns the stored model name."""
    try:
        zf = zipfile.ZipFile(BytesIO(file.read()))
    except zipfile.BadZipFile:
        raise ValueError("The file is not a valid .zip")

    # Index members by file name, ignoring folders and macOS metadata
    members = {}
    for name in zf.namelist():
        base = os.path.basename(name)
        if base and not name.startswith("__MACOSX/") and not base.startswith("._"):
            members.setdefault(base, name)

    if "model.json" not in members or "metadata.json" not in members:
        raise ValueError(
            "This zip doesn't look like a Teachable Machine Tensorflow.js export "
            "(expected model.json + metadata.json + weights.bin)"
        )

    model_json = json.loads(zf.read(members["model.json"]))
    metadata = json.loads(zf.read(members["metadata.json"]))
    if not metadata.get("labels"):
        raise ValueError("metadata.json contains no class labels")
    weight_files = [
        os.path.basename(p)
        for group in model_json.get("weightsManifest", [])
        for p in group.get("paths", [])
    ]
    missing = [w for w in weight_files if w not in members]
    if missing:
        raise ValueError(f"The zip is missing {', '.join(missing)}")

    target = os.path.join(app.config["UPLOAD_FOLDER"], base_name)
    os.makedirs(target)
    for fname in ["model.json", "metadata.json"] + weight_files:
        with open(os.path.join(target, fname), "wb") as out:
            out.write(zf.read(members[fname]))
    return base_name


def get_model_info(filename):
    """Describe a stored model: display name, labels, command mapping and file URLs."""
    path = os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(filename))
    if not os.path.isfile(os.path.join(path, "metadata.json")):
        return None

    with open(os.path.join(path, "metadata.json"), "r", encoding="utf-8") as f:
        labels = json.load(f).get("labels", [])

    # Stored as safe_name_YYYYMMDD_HHMMSS: strip the timestamp for display
    parts = filename.rsplit("_", 2)
    name = parts[0].replace("_", " ") if len(parts) == 3 else filename

    commands, recognised, warnings, method = map_labels(labels)
    return {
        "filename": filename,
        "name": name,
        "labels": labels,
        "commands": commands,
        "recognised": recognised,
        "warnings": warnings,
        "mapping_method": method,
        "size": sum(os.path.getsize(os.path.join(path, f)) for f in os.listdir(path)),
        "modified": datetime.fromtimestamp(os.path.getmtime(path)).isoformat(),
        "model_url": url_for("model_file", model=filename, file="model.json"),
        "metadata_url": url_for("model_file", model=filename, file="metadata.json"),
    }


def model_ready():
    """True if a model is selected (it runs in the pilot's browser)."""
    return current_model_info is not None


@app.before_request
def ensure_user_id():
    if "user_id" not in session:
        session["user_id"] = str(uuid.uuid4())
    expire_stale_pilot()


@app.route("/")
def index():
    """Serve control page as the landing page"""
    return render_template("control.html")


@app.route("/control")
def control_page():
    """Redirect to home"""
    return redirect(url_for("index"))


@app.route("/docs")
def documentation():
    """Serve documentation page"""
    return render_template("documentation.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    """Teacher login only"""
    if request.method == "GET":
        return render_template("login.html")  # Need to create this simple login page

    password = request.form.get("password", "")
    if password == TEACHER_PASSWORD:
        session["is_teacher"] = True
        return redirect(url_for("teacher_page"))
    else:
        return redirect(url_for("login", error="Invalid Teacher Password"))


@app.route("/logout")
def logout():
    session.pop("authenticated", None)
    session.pop("is_teacher", None)
    return redirect(url_for("index"))


@app.route("/teacher")
def teacher_page():
    """Teacher management page"""
    if not session.get("is_teacher"):
        return redirect(url_for("login"))
    return render_template("teacher.html")


@app.route("/api/control_status", methods=["GET"])
def control_status():
    """Get current pilot status"""
    global current_pilot, system_locked, pilot_last_active
    user_id = session.get("user_id")

    with pilot_lock:
        is_pilot = user_id == current_pilot
        if is_pilot:
            pilot_last_active = time.time()  # Heartbeat while control page is open
        pilot = current_pilot
        locked = system_locked

    return jsonify(
        {
            "current_pilot": pilot,
            "is_pilot": is_pilot,
            "user_id": user_id,
            "system_locked": locked,
            "mock_mode": getattr(robot_controller, 'mock_mode', False) if robot_controller else False
        }
    )


@app.route("/api/take_control", methods=["POST"])
def take_control():
    """Attempt to take control of the robot"""
    global current_pilot, system_locked, pilot_last_active

    if system_locked and not session.get("is_teacher"):
        return (
            jsonify(
                {"success": False, "message": "System is currently locked by teacher"}
            ),
            403,
        )

    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "No session ID"}), 400

    with pilot_lock:
        # Check if already controlled by someone else
        if current_pilot and current_pilot != user_id:
            return (
                jsonify(
                    {
                        "success": False,
                        "message": "Robot is currently controlled by another student",
                    }
                ),
                409,
            )

        current_pilot = user_id
        pilot_last_active = time.time()
        control_logger.info(f"User {user_id} took control")

    return jsonify({"success": True, "message": "You now have control"})


@app.route("/api/relinquish_control", methods=["POST"])
def relinquish_control():
    """Release control of the robot"""
    global current_pilot, pilot_last_active

    user_id = session.get("user_id")
    with pilot_lock:
        if current_pilot == user_id:
            current_pilot = None
            pilot_last_active = 0
            stop_robot_and_inference()
            control_logger.info(f"User {user_id} relinquished control")

    return jsonify({"success": True})


@app.route("/api/teacher/reset_control", methods=["POST"])
def teacher_reset_control():
    """Teacher force-resets control"""
    global current_pilot, pilot_last_active
    if not session.get("is_teacher"):
        return jsonify({"error": "Unauthorized"}), 403

    with pilot_lock:
        current_pilot = None
        pilot_last_active = 0
        stop_robot_and_inference()
        control_logger.info("Teacher reset control")

    return jsonify({"success": True})


@app.route("/api/teacher/lock_system", methods=["POST"])
def teacher_lock_system():
    """Teacher locks the system"""
    global system_locked, current_pilot, pilot_last_active
    if not session.get("is_teacher"):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    system_locked = data.get("locked", True)

    if system_locked:
        with pilot_lock:
            current_pilot = None  # Boot current pilot
            pilot_last_active = 0
            stop_robot_and_inference()
        control_logger.info("Teacher LOCKED the system")
    else:
        control_logger.info("Teacher UNLOCKED the system")

    return jsonify({"success": True, "locked": system_locked})


@app.route("/api/pilot_frame", methods=["GET"])
def get_pilot_frame():
    """Get the last frame and prediction sent by the current pilot"""
    return jsonify({"image": LAST_PILOT_FRAME, "prediction": LAST_PREDICTION_DATA})


@app.route("/logs")
def get_logs():
    """Get filtered control logs (Uploads and Commands only)"""
    try:
        control_log_path = os.path.join(logs_dir, "control.log")
        if not os.path.exists(control_log_path):
            return jsonify({"logs": []})

        # Read file and filter
        filtered_logs = []
        with open(control_log_path, "r") as f:
            for line in f:
                # Filter for useful events
                if any(
                    x in line
                    for x in [
                        "Uploaded model:",
                        "Command:",
                        "Moving",
                        "Turning",
                        "Rotating",
                        "Idle",
                        "Prediction",
                    ]
                ):
                    filtered_logs.append(line)

        # Return last 50 matches
        return jsonify({"logs": filtered_logs[-50:]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def ensure_prediction_buffer():
    global PREDICTION_BUFFER
    if PREDICTION_BUFFER is None:
        with PREDICTION_BUFFER_LOCK:
            if PREDICTION_BUFFER is None:
                PREDICTION_BUFFER = deque(maxlen=int(settings.get("buffer_size", 5)))


def process_probabilities(probabilities):
    """Turn one frame's class probabilities into a robot action.

    The probabilities come from the pilot's browser (/submit_prediction). Votes are
    robot commands, so two classes mapped to the same command count together.
    """
    global last_command_time, last_command_sent_time, LAST_SENT_COMMAND_NAME, LAST_PREDICTION_DATA

    labels = current_model_info["labels"]
    commands = current_model_info["commands"]

    top_index = max(range(len(probabilities)), key=lambda i: probabilities[i])
    confidence = float(probabilities[top_index])
    prediction = labels[top_index]
    predicted_command = commands[top_index]

    ensure_prediction_buffer()
    with PREDICTION_BUFFER_LOCK:
        PREDICTION_BUFFER.append(predicted_command)
        buffer_snapshot = list(PREDICTION_BUFFER)

    # Decide consensus only when buffer is full
    command_to_execute = "Idle"
    consensus_count = 0
    most_common = None
    if len(buffer_snapshot) >= int(settings.get("buffer_size", 5)):
        counts = Counter(buffer_snapshot)
        most_common, count = counts.most_common(1)[0]
        consensus_count = int(count)
        # Require that most_common is not 'Idle' and meets consensus_required
        if most_common != "Idle" and count >= int(settings.get("consensus_required", 3)):
            command_to_execute = most_common

    # Enforce confidence threshold for the latest frame before counting it as valid
    frame_valid = confidence >= settings.get("confidence_threshold", 0.65)

    # Rate-control: only send commands at most once per command_interval
    now = time.time()
    command_executed = False

    if command_to_execute != "Idle" and frame_valid:
        # Enough consensus to move — check rate limit
        interval = float(settings.get("command_interval", 0.1))
        if now - last_command_sent_time >= interval:
            if robot_controller and robot_controller.connected:
                robot_controller.execute_command(command_to_execute, settings["max_speed"])
                command_executed = True
                last_command_sent_time = now
                last_command_time = now
                # record last sent command name to avoid repeated idle stops
                LAST_SENT_COMMAND_NAME = command_to_execute
    else:
        # Not enough consensus — ensure robot is stopped
        if robot_controller and robot_controller.connected:
            # Only send stop/idle if last sent command was a movement (not already idle)
            if LAST_SENT_COMMAND_NAME is not None and LAST_SENT_COMMAND_NAME != "Idle":
                robot_controller.stop()
                LAST_SENT_COMMAND_NAME = "Idle"
            last_command_time = now

    # Check for timeout (existing behavior)
    time_since_last = time.time() - last_command_time if last_command_time > 0 else 0
    if time_since_last > COMMAND_TIMEOUT and last_command_time > 0:
        if robot_controller and robot_controller.connected:
            # Only send stop if we previously sent a movement command
            if LAST_SENT_COMMAND_NAME is not None and LAST_SENT_COMMAND_NAME != "Idle":
                robot_controller.stop()
                LAST_SENT_COMMAND_NAME = "Idle"

    probabilities = [float(p) for p in probabilities]

    # Update global prediction data for pilot view streamers
    LAST_PREDICTION_DATA = {
        "prediction": prediction,
        "confidence": confidence,
        "command_to_execute": command_to_execute,
        "labels": labels,
        "probabilities": probabilities,
    }

    return {
        "prediction": prediction,
        "predicted_command": predicted_command,
        "confidence": confidence,
        "labels": labels,
        "probabilities": probabilities,
        "threshold": settings["confidence_threshold"],
        "buffer_size": int(settings.get("buffer_size", 5)),
        "consensus_required": int(settings.get("consensus_required", 3)),
        "buffer_snapshot": buffer_snapshot,
        "most_common": most_common,
        "consensus_count": consensus_count,
        "command_to_execute": command_to_execute,
        "command_executed": command_executed,
        "time_since_last": time_since_last,
    }


@app.route("/submit_prediction", methods=["POST"])
def submit_prediction():
    """
    Accept class probabilities computed in the browser (TensorFlow.js model)
    Expects: JSON {"probabilities": [float per class], "image": optional base64 thumbnail}
    Returns: JSON with prediction, confidence, and command
    """
    global LAST_PILOT_FRAME, pilot_last_active

    if not is_current_pilot():
        return jsonify({"error": "Not the current pilot"}), 403
    if not (model_ready() and settings["inference_enabled"]):
        return (
            jsonify(
                {
                    "error": "Inference not enabled or no model loaded",
                    "model_loaded": model_ready(),
                    "inference_enabled": settings["inference_enabled"],
                }
            ),
            400,
        )

    data = request.get_json(silent=True) or {}
    probabilities = data.get("probabilities")
    if (
        not isinstance(probabilities, list)
        or len(probabilities) != len(current_model_info["labels"])
        or not all(isinstance(p, (int, float)) for p in probabilities)
    ):
        return jsonify({"error": "probabilities must list one number per class", "model_changed": True}), 400

    if data.get("image"):
        LAST_PILOT_FRAME = data["image"]
    pilot_last_active = time.time()

    try:
        return jsonify(process_probabilities(probabilities))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/upload_model", methods=["POST"])
def upload_model():
    """Upload a Teachable Machine Tensorflow.js export (.zip)"""
    if "model" not in request.files:
        return jsonify({"error": "No model file provided"}), 400

    file = request.files["model"]
    model_name = request.form.get("model_name", "").strip()

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not model_name:
        return jsonify({"error": "Model name is required"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Please upload the Teachable Machine Tensorflow.js .zip"}), 400

    try:
        # Name with timestamp: safe_name_YYYYMMDD_HHMMSS
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = secure_filename(model_name) or "model"
        filename = save_uploaded_model(file, f"{safe_name}_{timestamp}")
        info = get_model_info(filename)

        control_logger.info(
            "Uploaded model: %s (%s, labels: %s)", model_name, filename, info["labels"]
        )

        return jsonify(
            {
                "success": True,
                "message": "Model uploaded successfully",
                "filename": filename,
                "model_name": model_name,
                "model": info,
            }
        )

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/models", methods=["GET"])
def list_models():
    """List all uploaded models"""
    try:
        models = []
        if os.path.exists(app.config["UPLOAD_FOLDER"]):
            for filename in os.listdir(app.config["UPLOAD_FOLDER"]):
                try:
                    info = get_model_info(filename)
                except Exception as e:
                    control_logger.warning("Skipping unreadable model %s: %s", filename, e)
                    continue
                if info:
                    models.append(info)

        models.sort(key=lambda x: x["modified"], reverse=True)
        return jsonify({"models": models, "current": current_model_name})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/model_files/<model>/<path:file>")
def model_file(model, file):
    """Serve TensorFlow.js model files to the browser"""
    folder = os.path.abspath(os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(model)))
    if not os.path.isdir(folder):
        abort(404)
    return send_from_directory(folder, file)


@app.route("/load_model", methods=["POST"])
def load_model():
    """Select the shared model. It is then loaded and run in the pilot's browser."""
    global current_model_name, current_model_info

    if not is_current_pilot():
        return jsonify({"error": "Not the current pilot"}), 403

    filename = request.form.get("filename")
    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    try:
        info = get_model_info(filename)
        if info is None:
            return jsonify({"error": "Model file not found"}), 404

        current_model_name = filename
        current_model_info = info

        control_logger.info("Loaded model: %s", filename)

        return jsonify({"success": True, "message": f"Loaded model: {filename}", "model": info})
    except Exception as e:
        control_logger.error("Failed to load model: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/delete_model", methods=["POST"])
def delete_model():
    """Delete a model"""
    global current_model_name, current_model_info

    data = request.get_json()
    filename = os.path.basename(data.get("filename") or "")

    if not filename:
        return jsonify({"error": "Filename is required"}), 400

    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)

    if not os.path.exists(filepath):
        return jsonify({"error": "Model file not found"}), 404

    try:
        # Unload if it's the current model
        if current_model_name == filename:
            current_model_name = None
            current_model_info = None

        if os.path.isdir(filepath):
            shutil.rmtree(filepath)
        else:
            os.remove(filepath)

        return jsonify(
            {"success": True, "message": f"Model {filename} deleted successfully"}
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/reconnect_robot", methods=["POST"])
def reconnect_robot():
    """Manually trigger robot reconnection"""
    global robot_controller

    if not is_teacher():
        return jsonify({"error": "Unauthorized"}), 403

    try:
        if robot_controller is None:
            robot_controller = GO2Controller()
        
        success = robot_controller.connect()
        return jsonify({
            "success": success,
            "message": "Reconnection attempted",
            "connected": robot_controller.connected,
            "mock_mode": getattr(robot_controller, 'mock_mode', False)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/start_inference", methods=["POST"])
def start_inference():
    """Start inference and robot control"""
    global robot_controller

    if not is_current_pilot():
        return jsonify({"error": "Not the current pilot"}), 403

    if not model_ready():
        return jsonify({"error": "No model loaded"}), 400

    try:
        # Initialize robot controller if not exists
        if robot_controller is None:
            robot_controller = GO2Controller()

        if not robot_controller.connected:
            robot_controller.connect()

        settings["inference_enabled"] = True

        return jsonify(
            {
                "success": True,
                "message": "Inference started",
                "robot_connected": robot_controller.connected,
            }
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/stop_inference", methods=["POST"])
def stop_inference():
    """Stop inference and robot"""
    if not is_current_pilot():
        return jsonify({"error": "Not the current pilot"}), 403

    settings["inference_enabled"] = False

    if robot_controller and robot_controller.connected:
        robot_controller.stop()

    return jsonify({"success": True, "message": "Inference stopped"})


@app.route("/emergency_stop", methods=["POST"])
def emergency_stop():
    """Emergency stop - immediately stop robot"""
    if not is_current_pilot():
        return jsonify({"error": "Not the current pilot"}), 403

    settings["inference_enabled"] = False

    if robot_controller and robot_controller.connected:
        robot_controller.emergency_stop()

    return jsonify({"success": True, "message": "Emergency stop activated"})


@app.route("/settings", methods=["GET", "POST"])
def manage_settings():
    """Get or update settings"""
    if request.method == "POST":
        if not is_current_pilot():
            return jsonify({"error": "Not the current pilot"}), 403

        data = request.get_json(silent=True)
        validated, errors = validate_settings_payload(data)
        if errors:
            return (
                jsonify({"error": "Invalid settings payload", "details": errors}),
                400,
            )

        if "buffer_size" in validated:
            reconfigure_prediction_buffer(validated["buffer_size"])

        settings.update(validated)

        return jsonify({"success": True, "settings": settings})

    return jsonify(settings)


@app.route("/status", methods=["GET"])
def get_status():
    """Get system status"""
    global last_command_time, robot_controller, LAST_SENT_COMMAND_NAME

    # Background safety check: if no command for a while, stop robot
    now = time.time()
    if last_command_time > 0 and (now - last_command_time > COMMAND_TIMEOUT):
        if robot_controller and robot_controller.connected:
            if (
                LAST_SENT_COMMAND_NAME is not None
                and LAST_SENT_COMMAND_NAME.lower() != "idle"
            ):
                robot_controller.stop()
                LAST_SENT_COMMAND_NAME = "Idle"
                control_logger.info("Safety timeout: Robot stopped due to inactivity")

    return jsonify(
        {
            "inference_enabled": settings["inference_enabled"],
            "model_loaded": model_ready(),
            "current_model": current_model_name,
            "robot_connected": robot_controller is not None
            and robot_controller.connected,
            "settings": settings,
        }
    )


if __name__ == "__main__":
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
    control_logger.info(
        "Accept the security warning in your browser (Advanced -> Proceed)."
    )

    # Run with ad-hoc SSL context to allow camera access over network
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True, ssl_context="adhoc")

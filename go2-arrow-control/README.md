# GO2 Arrow Control System 🤖

Control your Unitree GO2 EDU robot using hand-drawn arrows and Google Teachable Machine!

> **🎯 IMPORTANT:** This system uses the **student's laptop camera** (via browser) for both training and testing. This ensures consistent camera environment and better model performance. No USB camera needed on the Jetson!

## 🎯 Overview

This system allows students to train their own machine learning models using Teachable Machine to control a Unitree GO2 robot. Students draw arrows on paper (Forward, Right, Left, Sit), train a model to recognize them, and then upload the model to control the robot in real-time!


## 📋 Requirements

### Hardware
- Unitree GO2 EDU robot
- NVIDIA Jetson Orin Nano
- Student laptops/tablets with webcams and modern browsers
- WiFi hotspot capability on Jetson

### Software
- Ubuntu 20.04/22.04 (Jetson)
- Python 3.10
- Unitree GO2 Python SDK (checkout [here](https://github.com/zhaw-physical-ai/go2_main/blob/main/INSTALL.md))
- TensorFlow Lite Runtime
- OpenCV

## 🚀 Installation

### 1. Clone the Repository

```bash
cd ~
git clone <your-repo-url>
cd go2-arrow-control
```

### 3. run the setup script

```
./setup.sh
```

### 4. Install Unitree SDK

please refer to [this](https://github.com/zhaw-physical-ai/go2_main/blob/main/INSTALL.md) Repo and follow the instructions to install and initialize the sdk.

### 5. Configure Network Interface

To find your network interface:
```bash
ifconfig
# or
ip addr show
```

### 6. Setup Hotspot (Optional but Recommended)

Create a WiFi hotspot on your Jetson so students can connect easily:

```bash
# Using nmcli
sudo nmcli device wifi hotspot ssid "GO2-Robot" password " go2demo123"
```

Or use the Network Manager GUI.

Or connect to any shared network.

## 🎓 Student Instructions

### Step 1: Train Your Model on Teachable Machine

1. Go to [Teachable Machine](https://teachablemachine.withgoogle.com/)
2. Choose "Image Project" → "Standard image model"
3. Create **5 classes**:
   - **Forward** - Draw an up arrow ↑
   - **Right** - Draw a right arrow →
   - **Left** - Draw a left arrow ←
   - **Sit** - Draw a down arrow ↓
   - **Idle** - record the background from different angles and some unrelated images

4. For each class:
   - Draw the arrow on white paper with a thick marker
   - Take 50-100 photos from different angles
   - Use good lighting
   - Try different distances

5. Click "Train Model"
6. Once trained, click "Export Model"
7. Choose "TensorFlow Lite"
8. Select "Quantized" model
9. Unzip the content
10. Download the `.tflite` file

### Step 2: Connect to the Robot's WiFi

Connect your laptop/tablet to the GO2 robot's WiFi hotspot:
- **Network Name**: GO2_Control_Hub (or as configured)
- **Password**: go2demo123 (or as configured)

### Step 3: Upload Your Model

1. Open web browser and go to: `http://10.42.0.1:5000` (or Hosts's IP)
2. Bypass the security warnings
3. Enter your name or team name in "Model Name"
4. Click "Choose File" and select your `.tflite` file
5. Click "Upload Model"
6. Wait for confirmation message

### Step 4: Activate Your Model

1. Press the "take control" button
2. Click the "Load" button after selecting your model
3. Wait for "Model loaded successfully" message
4. Your model is now active! (shown in green at the top)

### Step 5: Control the Robot!

1. Make sure the robot has clear space around it
2. Click the big green "▶️ Start Control" button
3. Hold your arrow drawings in front of the camera
4. The robot will move based on what it sees!
5. Click "⏸️ Stop Control" when done
6. **EMERGENCY**: Big red "🛑 EMERGENCY STOP" button is always available

### Tips for Best Results

- **Good Lighting**: Train and use in similar lighting conditions
- **Clear Arrows**: Draw arrows clearly with thick lines
- **Consistent Style**: Keep your drawing style consistent
- **Hold Steady**: Hold the paper steady for 1-2 seconds
- **Right Distance**: Same distance as during training works best
- **Start Slow**: Use low speed setting while learning


## 🛠️ Running the Server

### Start the Server

```bash
cd ~/go2-arrow-control
python3 server/app.py
```

You should see:
```
============================================================
GO2 Arrow Control System Starting...
============================================================
Server will be available at: http://0.0.0.0:5000
Models will be saved to: /path/to/uploads/models
============================================================
```

### Access the Web Interface

From any device on the same network:
```
http://<jetson-ip>:5000
```

Example: `http://192.168.1.100:5000`

## 🔒 Safety Features

1. **Confidence Threshold**: Only moves if model is confident
2. **Command Timeout**: Stops if no arrow detected for 2 seconds
3. **Emergency Stop**: Always available big red button
4. **Speed Limiting**: Configurable maximum speed
5. **No Backwards**: Robot sits instead (obstacle avoidance doesn't work backwards)

## 📁 Project Structure

```
go2-arrow-control/
├── server/
│   ├── app.py              # Main Flask application
│   ├── inference.py        # TFLite model inference
│   ├── robot_controller.py # GO2 robot control
│   └── uploads/
│       └── models/         # Uploaded student models
├── static/
│   ├── index.html          # Web interface
│   ├── css/
│   │   └── style.css       # Styles
│   └── js/
│       └── main.js         # Frontend JavaScript
├── requirements.txt        # Python dependencies
└── README.md              # This file
```


## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Additional movement patterns
- Multi-model comparison mode
- Training data augmentation tips
- Preset trained models
- Mobile-responsive design improvements

## 📝 License

MIT License - feel free to use for educational purposes!

## 🙏 Credits

- Uses Google Teachable Machine
- Unitree GO2 EDU robot

**Happy Robot Teaching! 🎓🤖**

# GO2 Arrow Control System 🤖

Control your Unitree GO2 EDU robot using hand-drawn arrows and Google Teachable Machine!

> **🎯 IMPORTANT:** This system uses the **student's laptop camera** (via browser) for both training and testing. This ensures consistent camera environment and better model performance. No USB camera needed on the Jetson!

## 🎯 Overview

This system allows high school students to train their own machine learning models using Teachable Machine to control a Unitree GO2 robot. Students draw arrows on paper (Forward, Right, Left, Rotate), train a model to recognize them, and then upload the model to control the robot in real-time!

## 🏗️ System Architecture

```
Students → Teachable Machine → Train Model → Export .tflite
                                                    ↓
                                            Upload to Server
                                                    ↓
Web Server (Jetson) ← Laptop Camera → Model Inference → Robot Commands
   (via browser)                                        ↓
                                            Unitree GO2 EDU
```

## 📋 Requirements

### Hardware
- Unitree GO2 EDU robot
- NVIDIA Jetson Orin Nano
- Student laptops/tablets with webcams and modern browsers
- WiFi hotspot capability on Jetson

### Software
- Ubuntu 20.04/22.04 (Jetson)
- Python 3.8+
- Unitree GO2 Python SDK
- TensorFlow Lite Runtime
- OpenCV

## 🚀 Installation

### 1. Clone the Repository

```bash
cd ~
git clone <your-repo-url>
cd go2-arrow-control
```

### 2. Install System Dependencies

```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-opencv
```

### 3. Install Python Dependencies

```bash
pip3 install -r requirements.txt
```

### 4. Install Unitree SDK

```bash
# Download and install Unitree SDK from official repository
# Follow instructions at: https://github.com/unitreerobotics/unitree_sdk2_python

# Example installation:
cd ~
git clone https://github.com/unitreerobotics/unitree_sdk2_python.git
cd unitree_sdk2_python
pip3 install -e .
```

### 5. Configure Network Interface

Edit `server/robot_controller.py` and update the network interface name:

```python
# Line ~37 in robot_controller.py
ChannelFactoryInitialize(0, "enp2s0")  # Change "enp2s0" to your interface name
```

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
sudo nmcli device wifi hotspot ssid "GO2-Robot" password "robotics123"
```

Or use the Network Manager GUI.

## 🎓 Student Instructions

### Step 1: Train Your Model on Teachable Machine

1. Go to [Teachable Machine](https://teachablemachine.withgoogle.com/)
2. Choose "Image Project" → "Standard image model"
3. Create **4 classes**:
   - **Forward** - Draw an up arrow ↑
   - **Right** - Draw a right arrow →
   - **Left** - Draw a left arrow ←
   - **Rotate** - Draw a down arrow ↓ (robot rotates instead of going backwards)

4. For each class:
   - Draw the arrow on white paper with a thick marker
   - Take 50-100 photos from different angles
   - Use good lighting
   - Try different distances

5. Click "Train Model"
6. Once trained, click "Export Model"
7. Choose "TensorFlow Lite"
8. Select "Quantized" model
9. Download the `.tflite` file

### Step 2: Connect to the Robot's WiFi

Connect your laptop/tablet to the GO2 robot's WiFi hotspot:
- **Network Name**: GO2-Robot (or as configured)
- **Password**: robotics123 (or as configured)

### Step 3: Upload Your Model

1. Open web browser and go to: `http://192.168.1.1:5000` (or Jetson's IP)
2. Scroll to "Upload New Model" section
3. Enter your name or team name in "Model Name"
4. Click "Choose File" and select your `.tflite` file
5. Click "Upload Model"
6. Wait for confirmation message

### Step 4: Activate Your Model

1. Find your model in the "Available Models" list
2. Click the "Load" button next to your model
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

## ⚙️ Settings

### Confidence Threshold (Default: 80%)
- How sure the model must be before moving the robot
- Higher = safer but less responsive
- Lower = more responsive but might move on unclear images

### Max Speed (Default: 0.3 m/s)
- Maximum robot movement speed
- Start low for safety!
- Range: 0.1 - 0.5 m/s

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

### Auto-Start on Boot (Optional)

Create a systemd service:

```bash
sudo nano /etc/systemd/system/go2-control.service
```

Add:
```ini
[Unit]
Description=GO2 Arrow Control System
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/go2-arrow-control
ExecStart=/usr/bin/python3 /home/your-username/go2-arrow-control/server/app.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable go2-control
sudo systemctl start go2-control
```

## 🐛 Troubleshooting

### Robot Not Connecting

1. Check network interface in `robot_controller.py`
2. Verify robot is powered on and connected to network
3. Check SDK installation: `python3 -c "import unitree_sdk2py"`

### Camera Not Working

**Browser shows "Camera access denied":**
1. Refresh the page
2. Click camera icon in address bar
3. Select "Allow" for camera permissions
4. Refresh page again

**Recommended browsers:**
- Chrome/Chromium (best support)
- Firefox
- Edge
- Safari (may have issues on older versions)

**Still not working:**
- Check another program isn't using the camera
- Try a different browser
- Check browser camera permissions in system settings

### Model Not Loading

- Ensure file is `.tflite` format
- Check file size (should be < 50MB)
- Verify model was exported as TensorFlow Lite (not TensorFlow.js)

### Low Confidence

- Retrain model with more examples
- Use consistent lighting
- Draw arrows more clearly
- Lower confidence threshold in settings

## 🔒 Safety Features

1. **Confidence Threshold**: Only moves if model is confident
2. **Command Timeout**: Stops if no arrow detected for 2 seconds
3. **Emergency Stop**: Always available big red button
4. **Speed Limiting**: Configurable maximum speed
5. **No Backwards**: Robot rotates instead (obstacle avoidance doesn't work backwards)

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

## 🎓 Educational Value

This project teaches students:
- Machine Learning basics (supervised learning, classification)
- Real-world ML deployment
- Web development (HTML, CSS, JavaScript, Flask)
- Robotics control systems
- Computer vision
- Safety considerations in robotics
- Debugging and iteration

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

- Built for high school robotics education
- Uses Google Teachable Machine
- Unitree GO2 EDU robot
- NVIDIA Jetson platform

## 📞 Support

For issues or questions:
1. Check troubleshooting section above
2. Verify all dependencies are installed
3. Check system status at `/status` endpoint
4. Review browser console for errors (F12)

---

**Happy Robot Teaching! 🎓🤖**

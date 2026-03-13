# 🎓 Workshop Leader Guide: GO2 Arrow Control

This guide contains essential information for conducting the AI workshop.
More information on the Workshop in general can be found [here](https://sagerpascal.github.io/AI-workshop/)

## 🔑 Quick Access & Credentials
| Entity | Detail | Password |
| :--- | :--- | :--- |
| **Orin SSH** | `ssh cai_demo@192.168.0.243` | (Ask Raphael) |
| **WiFi (Local)** | **SSID:** `TP-Link ...` | `57136332` |
| **Teacher Page** | `/teacher.html` | `teacher123` |¨

| Page| url | Info |
| :--- | :--- | :--- |
| **Direct Control Page** | [http://192.168.0.243:8080/](http://192.168.0.243:8080/) | (Try `https` if `http` fails) |
| **Workshop App** | [http://192.168.0.243:5000/](http://192.168.0.243:5000/) | (Try `https` if `http` fails) |

---

## 🚀 Presentation & Resources
- **Workshop Slides:** [sagerpascal.github.io/AI-workshop/workshop/](https://sagerpascal.github.io/AI-workshop/workshop/)
- **Fallback Model:** [example_model.tflite](example_model.tflite) (Use if Teachable Machine export fails)
- **Dev Docs:** [go2-arrow-control/DEV_README.md](go2-arrow-control/DEV_README.md)

---

## Setup

1. Plug in the router (find credentials above).
2. Mount the Orin onto the Robodog (currently using tape), it will automatically connect to the network and be available via ssh (`ssh cai_demo@192.168.0.243`) when booted.
3. Start the robodog by pressing the button short then long.
4. Use the remote control to move it to the desired location.


## 🛠️ Startup Procedure (3 Terminals)

This assumes the App is set up on the orin and the SDK has been installed properly (is the case by default, if not refer to "Installation" below or DEV_README.md).
Connect to the Orin via SSH and run the following in separate sessions:

1. **Terminal 1: Robot Bridge**
   ```bash
   conda activate go2_py311
   cd go2_main
   GO2_NETWORK_INTERFACE=enP8p1s0 python -m go2_bridge
   ```

2. **Terminal 2: Web App**
   ```bash
   conda activate go2_py311
   cd go2_main
   python -m go2_webapp
   ```
   *Note: Use `http` prefix for external access.*

3. **Terminal 3: Arrow Controller**
   ```bash
   conda activate demo_workshops
   cd Public/demo_workshops/go2-arrow-control/server/
   python app.py
   ```

---

## 🧠 Teachable Machine Settings
When guiding students to train their models, ensure:
1. **Labels Order (Strict):**
   1. `Forward`
   2. `Right`
   3. `Left`
   4. `Sit`
   5. `Idle`
2. **Export Format:** 
   - **Tensorflow Lite** -> **Floating point** (tflite)

---

## 🔍 Troubleshooting
- **Network Interface:** Run `ip addr` to verify. Expected: `enP8p1s0`.
- **Connection Refused:** Toggle between `http://` and `https://` in the browser.
- **System Freeze:** If the network drops or servers hang, run `sudo reboot`.
- **Environment:** If local testing is needed, refer to [go2-arrow-control/DEV_README.md](go2-arrow-control/DEV_README.md).

---

## 🚀 Installation

### 1. Clone the Repository

```bash
cd ~
git clone <your-repo-url>
cd go2-arrow-control
```

### 3. run the setup script (conda required)

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

## 🎓 Student Instructions

### Step 1: Train Your Model on Teachable Machine

1. Go to [Teachable Machine](https://teachablemachine.withgoogle.com/)
2. Choose "Image Project" → "Standard image model"
3. Create **5 classes**:
   - **Forward** - Draw an up arrow ↑
   - **Right** - Draw a right arrow →
   - **Left** - Draw a left arrow ←
   - **Backwards** - Draw a down arrow ↓
   - **Idle** - record the background from different angles and some unrelated images
 ! Important the order of the classes must match this description as this is how the app will interpret the commands.
4. For each class:
   - Draw the arrow on white paper with a thick marker
   - Take 150-300 photos from different angles
   - Use good lighting
   - Try different distances

5. Click "Train Model"
6. Once trained, click "Export Model"
7. Choose "TensorFlow Lite"
8. Select "Floating Point" model (not Quantized!)
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

## 🤝 Contributing

Contributions welcome! Contact me

## 📝 License

MIT License - feel free to use for educational purposes!

## 🙏 Credits

- Uses Google Teachable Machine
- Unitree GO2 EDU robot

**Happy Robot Teaching! 🎓🤖**

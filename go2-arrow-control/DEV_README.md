# DEV_README 🚀

Essential commands to get the GO2 Arrow Control system running.

## 💻 Local Development Setup
Run the server on your local machine for UI testing or simulation.

1. **Environment Setup**:
   ```bash
   ./setup.sh
   conda activate demo_workshops
   ```

2. **Run Server**:
   ```bash
   python3 server/app.py
   ```
   Access at: [http://localhost:5000](http://localhost:5000)

---

## 🤖 Jetson Orin Setup (Robot Version)
Commands to deploy and test on the physical Jetson hardware.
1. ** Connect to Jetson orin**
The hotspot should start automatically when the orin boots, find credentials below.

    ```bash
    ssh cai_demo@10.42.0.1, pw: ask admin
    ```

2. ** clone repo to orin**
    It may be easier to just scp it from your machine if the hotspot is already set up. (ssh cai_demo@10.42.0.1, pw: ask admin)

3. **Prepare Environment**:
   ```bash
   ./setup.sh
   conda activate demo_workshops
   ```

4. **Run Tests**:
   ```bash
   python3 test_system.py
   ```

5. **Launch Production Server**:
   ```bash
   python3 server/app.py
   ```
   Access at: `http://10.42.0.1:5000` (Default Hotspot IP)

---

## Test model
If you want to create your own model, follow the instructions in STUDENT_SETUP_GUIDE.md
else you can use the example model in this repo: example_model.tflite


## 🔑 Required Credentials

| Service | Username/SSID | Password |
| :--- | :--- | :--- |
| **WiFi Hotspot** | `GO2_Control_Hub` | `go2demo123` |
| **Teacher Dashboard** | N/A | `teacher123` |
| **Jetson System** | `bot` | `ask admin` |

---

## 📚 Further Documentation
For detailed configuration, troubleshooting, and student guides, see:
- [README.md](README.md) - Main project overview.
- [JETSON_SETUP_GUIDE.md](JETSON_SETUP_GUIDE.md) - Hardware specific setup.
- [TEACHER_CHECKLIST.md](TEACHER_CHECKLIST.md) - Deployment steps.
- [STUDENT_GUIDE.md](STUDENT_GUIDE.md) - User instructions.

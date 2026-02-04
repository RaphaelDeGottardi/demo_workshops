# Teacher's Deployment Checklist 📋

## Pre-Class Setup (Do Once)

### 1. Hardware Setup
- [ ] Unitree GO2 robot fully charged
- [ ] Jetson Orin Nano powered and booted
- [ ] Robot has clear 10ft x 10ft space for operation
- [ ] Emergency stop accessible
- [ ] Power outlets available for Jetson

### 2. Software Installation
- [ ] Clone repository to Jetson: follow JETSON_SETUP_GUIDE.md
- [ ] Connect to hotspot and log in via ssh
- If connected to robot: 
  - [ ] Install Unitree SDK (not required for mock)
  - [ ] Update network interface in `server/robot_controller.py`
- [ ] Test system: `python3 test_system.py`
- [ ] start the server by running `server/app.py`

### 3. Network Configuration
- [ ] WiFi hotspot configured on Jetson
  - SSID: `GO2-Robot` (or your choice)
  - Password: `go2demo123` (or your choice)
  - IP address: `192.168.1.1` or note actual IP
- [ ] Test connection from student device
- [ ] Access web interface successfully
- [ ] Write connection details on whiteboard

### 4. Camera Setup
- [ ] Students use their **laptop cameras** (via browser)
- [ ] No USB camera needed on Jetson
- [ ] Test browser camera access on sample laptop
- [ ] Verify students can allow camera permissions
- [ ] Good lighting in room (for student laptops)
- [ ] Inform students about camera permission prompt

### 5. Safety Setup
- [ ] Clear operation area marked
- [ ] Safety rules posted
- [ ] Emergency stop tested
- [ ] Students briefed on safety
- [ ] Supervision plan in place

## Before Each Class

### 10 Minutes Before Class
- [ ] Power on GO2 robot
- [ ] Boot Jetson Orin Nano
- [ ] Verify WiFi hotspot is active
- [ ] Start server: `cd ~/go2-arrow-control && python3 server/app.py`
- [ ] Verify server starts without errors
- [ ] Test browser camera access from a student laptop
- [ ] Test robot connection (check status bar)

### Write on Whiteboard
```
GO2 Robot Control
-----------------
1. WiFi: GO2-Robot
2. Password: robotics123
3. Website: http://192.168.1.1:5000
4. See STUDENT_GUIDE.md for instructions
```

### 5 Minutes Before Class
- [ ] Clear robot operation area
- [ ] Position robot in starting location
- [ ] Test one complete cycle (upload → load → control)
- [ ] Verify emergency stop works

## During Class

### Student Workflow Checklist
For each student/group:
- [ ] Student has trained model on Teachable Machine
- [ ] Student exported as TensorFlow Lite (.tflite)
- [ ] Student connected to WiFi
- [ ] Student uploaded model with unique name
- [ ] Student loaded their model
- [ ] Student tested control with supervision
- [ ] Student stopped control when done
- [ ] Next student ready to start

### Monitoring Checklist
- [ ] Watch robot at all times
- [ ] Check status bar shows:
  - Green model status
  - Green robot status
  - Appropriate inference status
- [ ] Monitor confidence levels (should be > 80%)
- [ ] Ensure safe operation area maintained
- [ ] Help debug issues as needed

### Common Issues During Class

**Camera not showing:**
- Student needs to allow camera permissions
- Click camera icon in browser address bar
- Select "Allow" and refresh page
- Try different browser (Chrome recommended)
- Check no other app is using camera

**Robot not moving:**
- Check robot connection (status bar)
- Verify model is loaded
- Check "Start Control" was pressed
- Try emergency stop, then restart

**Low confidence:**
- Lighting may be different from training
- Drawing style may be unclear
- Suggest retraining with more examples
- Adjust confidence threshold temporarily

**Wrong predictions:**
- Model needs more training data
- Arrows may be too similar
- Suggest clearer drawings
- Have student retrain

## After Class

### Shutdown Procedure
- [ ] Stop all inference (press Stop Control)
- [ ] Stop server (Ctrl+C in terminal)
- [ ] Power down robot properly
- [ ] Save any student models if requested
- [ ] Clean operation area

### Optional: Save Student Work
```bash
# Backup student models
cd ~/go2-arrow-control/server/uploads/models
tar -czf models_backup_$(date +%Y%m%d).tar.gz *.tflite
```

## Troubleshooting Guide

### Server Won't Start
```bash
# Check if port is in use
sudo lsof -i :5000

# Kill existing process if needed
sudo kill <PID>

# Check for errors
python3 server/app.py
```

### Robot Won't Connect
```bash
# Check network interface
ip addr show

# Test robot network
ping <robot-ip>

# Check SDK installation
python3 -c "import unitree_sdk2py"
```

### Camera Issues
**Student can't access camera:**
```
1. Browser permissions required
2. Click camera icon in address bar
3. Set to "Allow"
4. Refresh page
5. Try Chrome if Safari/Firefox fails
```

**Video lag or stuttering:**
```
1. Check WiFi signal strength
2. Reduce number of active users
3. Close other programs on student laptop
4. Reduce frame rate if needed (edit INFERENCE_FPS in main.js)
```

## Student Success Metrics

Track for learning assessment:
- [ ] Students successfully trained models
- [ ] Students uploaded models correctly
- [ ] Students controlled robot with their model
- [ ] Students understood confidence threshold
- [ ] Students debugged issues independently
- [ ] Students iterated to improve models

## Advanced Features for Fast Learners

If students finish early, suggest:
1. **Obstacle Course**: Set up cones to navigate
2. **Precision Challenge**: Park robot in specific spot
3. **Multi-Arrow**: Train with combinations
4. **Speed Optimization**: Adjust settings for faster movement
5. **Model Comparison**: Compare different training approaches

## Safety Reminders

### For Teacher
- Always supervise when robot is active
- Keep emergency stop accessible
- Maintain clear operation area
- One robot operator at a time
- Stop immediately if anything unusual

### For Students (Post Visibly)
1. 🛑 Emergency stop ALWAYS available
2. 👀 Watch robot at all times
3. 📏 Stay clear of operation area
4. ✋ Don't touch moving robot
5. 🗣️ Alert teacher of any issues

## Class Time Allocation

**Suggested Schedule (60 minutes):**
- 0-5 min: Introduction and safety briefing
- 5-10 min: Demonstration
- 10-40 min: Student work time (train, upload, test)
- 40-55 min: Student presentations/challenges
- 55-60 min: Wrap-up and cleanup

**For Longer Sessions:**
Add obstacle courses, competitions, or model improvement iterations

## Notes Section

Use this space to track:
- Issues encountered
- Student questions
- Ideas for improvement
- Hardware problems
- Network issues

---

Date: ____________
Class: ____________
Issues: _______________________________________
_____________________________________________
_____________________________________________

Success Stories: _______________________________
_____________________________________________
_____________________________________________

## Quick Reference Commands

```bash
# Start server
cd ~/go2-arrow-control
python3 server/app.py

# Test system
python3 test_system.py

# Check status
curl http://localhost:5000/status

# View logs
# (if running as service)
sudo journalctl -u go2-control -f

# Backup models
cd server/uploads/models
tar -czf backup.tar.gz *.tflite

# Clean old models
# (do at end of semester)
rm *_2024*.tflite
```

## Contact Information

**Support Resources:**
- Unitree Documentation: https://support.unitree.com/
- Teachable Machine Help: https://teachablemachine.withgoogle.com/
- Project README: See README.md in project folder

**Emergency Contact:**
- IT Support: ___________________
- Robotics Supervisor: ___________________

---

**Good luck with your class! This will be an amazing learning experience for your students! 🎓🤖**

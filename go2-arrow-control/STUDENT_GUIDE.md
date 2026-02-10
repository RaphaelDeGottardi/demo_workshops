# Student Quick Start Guide 🎓

## Before You Start

✅ Make sure the camera is the same one used for training!
✅ Have your trained .tflite model file ready
✅ Robot is powered on and has clear space around it
✅ You're connected to the robot's WiFi network

## Step-by-Step Instructions

### 1️⃣ Create Your Training Data

**Go to Teachable Machine:**
- Open: https://teachablemachine.withgoogle.com/
- Click "Get Started" → "Image Project" → "Standard image model"

**Create 5 Classes (optional Idle):**

**Class 1: Forward**
- Draw an UP arrow (↑) on white paper
- Take 50+ photos from different angles
- Keep the arrow clearly visible

**Class 2: Right**  
- Draw a RIGHT arrow (→) on white paper
- Take 50+ photos from different angles

**Class 3: Left**
- Draw a LEFT arrow (←) on white paper  
- Take 50+ photos from different angles

**Class 4: Rotate**
- Draw a DOWN arrow (↓) on white paper
- Take 50+ photos from different angles
-- (Robot will rotate in place - safer than going backwards!)

**Important: Class Order and Counts**

- The system maps model outputs to commands by the order of classes in Teachable Machine (top → bottom). The label names themselves are not important — what matters is the order in which you create them.

- Example mapping (Teachable Machine class order):
   1. Forward
   2. Right
   3. Left
   4. Rotate
   5. Idle

- If your model produces fewer or more output classes than expected, the server will attempt to adjust but will warn you. Uploading or loading a model whose number of output classes does not match the number of labels can be unsafe — the wrong prediction may cause unintended robot movement.

**Class 5: Idle**
- Draw a neutral symbol or show no arrow — robot will stand still

**Tips for Good Training:**
- Use thick black marker for arrows
- Use white/light colored paper
- Take photos from the same distance you'll use the robot
- Include slight variations (tilted, different positions)
- Same lighting as where you'll use the robot

### 2️⃣ Train Your Model

1. Click "Train Model" button (wait 2-5 minutes)
2. Test your model using the webcam preview
3. If it works well, proceed to export
4. If not, add more training images and retrain

### 3️⃣ Export Your Model

1. Click "Export Model" button
2. Select "TensorFlow" tab
3. Choose "TensorFlow Lite"
4. Select "Quantized" (smaller, faster)
5. Click "Download my model"
6. Unzip the downloaded file
7. Find the `.tflite` file (ignore the labels.txt)

### 4️⃣ Connect to Robot

1. Connect to WiFi network: **GO2_Control_Hub**
2. Password: **go2demo123**
3. Open browser: **http://10.42.0.1:5000**
   (or the IP address your teacher provides)
4. **IMPORTANT:** When asked, click **"Allow"** to let the website use your camera
   - This is the same camera you used for training!
   - The video never leaves your school's network

### 5️⃣ Upload Your Model

1. In the web interface, find "Upload New Model" section
2. **Model Name**: Enter your name (e.g., "John Smith")
3. **Model File**: Click "Choose File" and select your `.tflite` file
4. Click "📤 Upload Model" button
5. Wait for "Model uploaded successfully! ✓" message

### 6️⃣ Load Your Model

1. Scroll down to "Available Models"
2. Find your model in the list
3. Click the "Load" button next to it
4. Wait for "Model loaded successfully! ✓"
5. The top status bar should show your model name in green

### 7️⃣ Test Your Model

1. **Look at the camera view** - you should see live video
2. Hold your arrow drawing in front of the camera
3. Check if the prediction appears on screen
4. Make sure it correctly identifies each arrow
5. If predictions are wrong, you may need to retrain

### 8️⃣ Control the Robot! 🎉

1. **Safety First**: Make sure robot has 6+ feet of clear space
2. Click the green **"▶️ Start Control"** button
3. The camera view will show predictions
4. Hold your arrow steady in front of camera (1-2 seconds)
5. Robot will move based on the arrow!

**Commands:**
- UP arrow (↑) → Robot moves **forward**
- RIGHT arrow (→) → Robot **turns right**
- LEFT arrow (←) → Robot **turns left**
- DOWN arrow (↓) → Robot **rotates in place**

### 9️⃣ When You're Done

1. Click **"⏸️ Stop Control"** button
2. Robot will stop moving
3. Next student can upload their model!

## ⚠️ Important Safety Rules

🛑 **EMERGENCY STOP**: The big red button **ALWAYS** works - press it anytime!

✋ **Never** walk behind the robot while it's moving

👀 **Always** watch the robot - don't look away

🚫 **Stop immediately** if robot acts strange or unexpected

📏 **Keep clear space** - at least 6 feet in all directions

## ⚙️ Settings You Can Adjust

**Confidence Threshold** (default 80%)
- How sure the model must be before robot moves
- **Higher** = safer, less responsive
- **Lower** = more responsive, might move by accident

**Max Speed** (default 0.3)
- How fast the robot can move
- **Start low!** Increase only when confident
- Range: 0.1 (slow) to 0.5 (fast)

## 🐛 Troubleshooting

**"Camera access denied" or camera not working:**
- Refresh the web page
- Click the camera icon in your browser's address bar
- Select "Allow" for camera access
- Refresh again
- Try Chrome or Firefox if Safari doesn't work

**"Confidence too low" appears:**
- Hold arrow closer/further from camera
- Draw arrow more clearly
- Train model with more examples
- Lower confidence threshold in settings

**Robot doesn't move:**
- Check "Start Control" button is pressed
- Check robot status shows "Connected"
- Check camera is working (see live video?)
- Try emergency stop, then start again

**Wrong direction:**
- Your model might be confused
- Add more training photos
- Retrain the model
- Make arrows more distinct

**Camera shows nothing:**
- Check camera is plugged in
- Refresh the web page
- Ask teacher to check camera connection

## 💡 Pro Tips

1. **Draw clearly**: Thick lines, simple arrows
2. **Good lighting**: Same as when you trained
3. **Hold steady**: Keep arrow still for 1-2 seconds
4. **Practice**: Try each arrow a few times first
5. **Distance matters**: Same distance as training photos
6. **Start slow**: Use low speed while learning
7. **Watch confidence**: Higher confidence = better predictions

## 🏆 Challenge Ideas

After basic control works:
1. **Obstacle course**: Navigate through cones
2. **Speed challenge**: Complete course fastest
3. **Precision**: Park in specific spot
4. **Complex patterns**: Figure-8, square, etc.
5. **Team relay**: Pass control between teammates

## 📝 Learning Goals

By doing this project, you've learned:
- ✅ How machine learning works
- ✅ Training and testing models
- ✅ Real-world ML deployment
- ✅ Robot control systems
- ✅ Computer vision basics
- ✅ Debugging and iteration

## 🎯 Next Steps

Want to improve your model?
1. Add more training images (100+ per class)
2. Try different arrow styles
3. Include more lighting conditions
4. Add background variations
5. Test with different people's drawings

## 🙋 Need Help?

1. Check the troubleshooting section above
2. Ask your teacher or classmates
3. Try refreshing the web page
4. Check if model is loaded (green status at top)
5. Try uploading a new model

---

**Remember**: This is a learning experience! If something doesn't work perfectly, that's okay - it's part of the process. Try different things, learn from mistakes, and have fun! 🎓🤖

**Most importantly: HAVE FUN CONTROLLING THE ROBOT! 🎉**

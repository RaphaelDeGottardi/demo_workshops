#!/bin/bash

# GO2 Arrow Control - Setup Script
# This script creates necessary directories and checks dependencies

echo "======================================================"
echo "GO2 Arrow Control System - Setup"
echo "======================================================"
echo ""

# Create directory structure
echo "Creating directory structure..."
mkdir -p server/uploads/models
mkdir -p static/css
mkdir -p static/js

echo "✓ Directories created"
echo ""

# Ensure conda environment exists and is activated (if conda is available)
echo "Checking for Conda..."
if command -v conda >/dev/null 2>&1; then
    echo "✓ conda found"
    CONDA_BASE=$(conda info --base 2>/dev/null)
    if [ -n "$CONDA_BASE" ]; then
        . "$CONDA_BASE/etc/profile.d/conda.sh"
    fi
    ENV_NAME="demo_workshops"
    if conda env list | awk '{print $1}' | grep -qx "$ENV_NAME"; then
        echo "✓ Conda environment '$ENV_NAME' exists"
    else
        if [ -f environment.yml ]; then
            echo "Creating conda environment '$ENV_NAME' from environment.yml..."
            conda env create -f environment.yml || { echo "✗ Failed to create conda environment"; exit 1; }
        else
            echo "⚠ environment.yml not found; skipping conda environment creation"
        fi
    fi
    echo "Activating conda environment '$ENV_NAME'..."
    conda activate "$ENV_NAME"
    if [ $? -eq 0 ]; then
        echo "✓ Activated $ENV_NAME"
    else
        echo "⚠ Failed to activate $ENV_NAME; continuing with current shell environment"
    fi
else
    echo "⚠ conda not found. Continuing with system Python/pip"
fi

# Check Python version
echo "Checking Python version..."
python3 --version
if [ $? -eq 0 ]; then
    echo "✓ Python 3 found"
else
    echo "✗ Python 3 not found. Please install Python 3.8 or higher."
    exit 1
fi
echo ""

# Check if pip is installed
echo "Checking pip..."
pip3 --version
if [ $? -eq 0 ]; then
    echo "✓ pip3 found"
else
    echo "✗ pip3 not found. Installing..."
    sudo apt-get install -y python3-pip
fi
echo ""

# Check for Unitree SDK
echo "Checking for Unitree SDK..."
python3 -c "import unitree_sdk2py" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✓ Unitree SDK found"
else
    echo "⚠ Unitree SDK not found"
    echo "This is assuming that you are testing on a different machine without the robot."
    echo "If you are using the Unitree GO2 Arrow robot, please install the SDK"
    #sudo apt install python3-pip
    #git clone https://github.com/unitreerobotics/unitree_sdk2_python.git
    #cd unitree_sdk2_python
    #pip3 install -e .
fi
echo ""

# Get network interfaces
echo "Available network interfaces:"
echo "------------------------------"
ip addr show | grep "^[0-9]" | cut -d: -f2 | tr -d ' '
echo ""
echo "⚠ Update the network interface in server/robot_controller.py"
echo "  Current setting: enp2s0 (line ~37)"
echo ""

# Check if running on Jetson
echo "Platform detection..."
if [ -f /etc/nv_tegra_release ]; then
    echo "✓ Running on NVIDIA Jetson"
    echo "  $(cat /etc/nv_tegra_release)"
else
    echo "⚠ Not running on NVIDIA Jetson"
    echo "  System will work but robot control may be simulated"
fi
echo ""

# Get IP addresses
echo "Network configuration:"
echo "------------------------------"
hostname -I | tr ' ' '\n'
echo ""
echo "Access the web interface at: http://[IP-ADDRESS]:5000"
echo ""

# Summary
echo "======================================================"
echo "Setup Complete!"
echo "======================================================"
echo ""
echo "Next steps:"
echo "1. Review server/robot_controller.py and update network interface"
echo "2. Ensure robot is powered on and connected"
echo "3. Run: python3 server/app.py"
echo "4. Access web interface from student devices"
echo ""
echo "For detailed instructions, see README.md"
echo "For student guide, see STUDENT_GUIDE.md"
echo ""
echo "======================================================"

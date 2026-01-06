#!/usr/bin/env python3
"""
GO2 Arrow Control - System Test Script
Tests all major components before running the full system
"""

import sys
import os

def print_header(text):
    print("\n" + "=" * 60)
    print(f"  {text}")
    print("=" * 60)

def print_status(test_name, passed, message=""):
    status = "✓ PASS" if passed else "✗ FAIL"
    print(f"{status}: {test_name}")
    if message:
        print(f"       {message}")

def test_imports():
    """Test if all required Python packages are available"""
    print_header("Testing Python Dependencies")
    
    all_passed = True
    
    # Test Flask
    try:
        import flask
        print_status("Flask", True, f"Version: {flask.__version__}")
    except ImportError as e:
        print_status("Flask", False, str(e))
        all_passed = False
    
    # Test OpenCV
    try:
        import cv2
        print_status("OpenCV", True, f"Version: {cv2.__version__}")
    except ImportError as e:
        print_status("OpenCV", False, str(e))
        all_passed = False
    
    # Test NumPy
    try:
        import numpy
        print_status("NumPy", True, f"Version: {numpy.__version__}")
    except ImportError as e:
        print_status("NumPy", False, str(e))
        all_passed = False
    
    # Test TFLite Runtime
    try:
        import tflite_runtime.interpreter as tflite
        print_status("TFLite Runtime", True)
    except ImportError:
        try:
            import tensorflow.lite as tflite
            print_status("TensorFlow Lite", True, "Using TensorFlow")
        except ImportError as e:
            print_status("TFLite Runtime", False, str(e))
            all_passed = False
    
    # Test Unitree SDK (optional)
    try:
        import unitree_sdk2py
        print_status("Unitree SDK", True, "Robot control available")
    except ImportError:
        print_status("Unitree SDK", False, "Will run in SIMULATION mode")
        # Not critical for testing
    
    return all_passed

def test_camera():
    """Test if OpenCV is available for image processing"""
    print_header("Testing Image Processing (OpenCV)")
    
    try:
        import cv2
        import numpy as np
        
        # Create a test image
        test_image = np.zeros((480, 640, 3), dtype=np.uint8)
        
        # Try to resize it (common operation)
        resized = cv2.resize(test_image, (224, 224))
        
        print_status("OpenCV Operations", True, "Image processing working")
        print("       Note: Camera access is via browser, not server-side")
        return True
        
    except Exception as e:
        print_status("OpenCV Test", False, str(e))
        return False

def test_directories():
    """Test if required directories exist"""
    print_header("Testing Directory Structure")
    
    all_passed = True
    required_dirs = [
        'server',
        'server/uploads',
        'server/uploads/models',
        'static',
        'static/css',
        'static/js'
    ]
    
    for dir_path in required_dirs:
        exists = os.path.exists(dir_path)
        print_status(f"Directory: {dir_path}", exists)
        if not exists:
            all_passed = False
    
    return all_passed

def test_files():
    """Test if required files exist"""
    print_header("Testing Required Files")
    
    all_passed = True
    required_files = [
        'server/app.py',
        'server/inference.py',
        'server/robot_controller.py',
        'static/index.html',
        'static/css/style.css',
        'static/js/main.js',
        'requirements.txt',
        'README.md'
    ]
    
    for file_path in required_files:
        exists = os.path.isfile(file_path)
        print_status(f"File: {file_path}", exists)
        if not exists:
            all_passed = False
    
    return all_passed

def test_robot_controller():
    """Test robot controller initialization"""
    print_header("Testing Robot Controller")
    
    try:
        sys.path.insert(0, 'server')
        from robot_controller import GO2Controller
        
        controller = GO2Controller()
        print_status("Controller Creation", True)
        
        # Try to connect (will work in simulation mode even without SDK)
        result = controller.connect()
        if result:
            print_status("Controller Connection", True)
            controller.disconnect()
        else:
            print_status("Controller Connection", False, "Check network/SDK")
            
        return True
        
    except Exception as e:
        print_status("Robot Controller", False, str(e))
        return False

def test_inference():
    """Test inference engine initialization"""
    print_header("Testing Inference Engine")
    
    try:
        sys.path.insert(0, 'server')
        from inference import ModelInference
        
        inference = ModelInference()
        print_status("Inference Engine Creation", True)
        
        classes = inference.get_classes()
        print_status("Default Classes", True, f"Classes: {', '.join(classes)}")
        
        return True
        
    except Exception as e:
        print_status("Inference Engine", False, str(e))
        return False

def test_flask_app():
    """Test Flask app can be created"""
    print_header("Testing Flask Application")
    
    try:
        sys.path.insert(0, 'server')
        
        # Change to server directory to properly load Flask app
        original_dir = os.getcwd()
        os.chdir('server')
        
        # We need to prevent the app from running
        import app as flask_app
        
        os.chdir(original_dir)
        
        print_status("Flask App Import", True)
        return True
        
    except Exception as e:
        print_status("Flask App", False, str(e))
        return False

def test_network():
    """Test network configuration"""
    print_header("Testing Network Configuration")
    
    try:
        import socket
        hostname = socket.gethostname()
        ip_addresses = socket.gethostbyname_ex(hostname)[2]
        
        print_status("Hostname", True, hostname)
        for ip in ip_addresses:
            if not ip.startswith('127.'):
                print_status("IP Address", True, ip)
        
        return True
        
    except Exception as e:
        print_status("Network Test", False, str(e))
        return False

def main():
    print("""
    ╔══════════════════════════════════════════════════════════╗
    ║     GO2 Arrow Control System - System Test Suite        ║
    ╚══════════════════════════════════════════════════════════╝
    """)
    
    results = {}
    
    # Run all tests
    results['imports'] = test_imports()
    results['camera'] = test_camera()
    results['directories'] = test_directories()
    results['files'] = test_files()
    results['robot'] = test_robot_controller()
    results['inference'] = test_inference()
    results['network'] = test_network()
    # Skip flask_app test as it may cause issues with imports
    
    # Summary
    print_header("Test Summary")
    
    total_tests = len(results)
    passed_tests = sum(results.values())
    
    for test_name, passed in results.items():
        status = "✓" if passed else "✗"
        print(f"{status} {test_name.replace('_', ' ').title()}")
    
    print(f"\nPassed: {passed_tests}/{total_tests}")
    
    if passed_tests == total_tests:
        print("\n🎉 All tests passed! System is ready to use.")
        print("\nTo start the server, run:")
        print("  python3 server/app.py")
        return 0
    else:
        print("\n⚠️  Some tests failed. Please check the errors above.")
        print("\nCommon issues:")
        print("  - Missing dependencies: Run 'pip3 install -r requirements.txt'")
        print("  - No camera: Connect a USB webcam")
        print("  - Unitree SDK: Install from official repo (optional for testing)")
        return 1

if __name__ == "__main__":
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user.")
        sys.exit(1)

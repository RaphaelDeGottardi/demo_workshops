"""
Unitree GO2 Robot Controller
Handles robot movement commands with safety features
"""

import time
import threading
import logging

try:
    from unitree_sdk2py.core.channel import ChannelPublisher, ChannelFactoryInitialize
    from unitree_sdk2py.idl.default import unitree_go_msg_dds__SportModeCmd_
    from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeCmd_
    SDK_AVAILABLE = True
except ImportError:
    logging.getLogger('control').warning("Unitree SDK not found. Robot control will be simulated.")
    SDK_AVAILABLE = False


class GO2Controller:
    def __init__(self):
        self.connected = False
        self.publisher = None
        self.last_command = None
        self.last_command_time = 0
        self.command_lock = threading.Lock()
        
        # Movement parameters
        self.default_forward_speed = 0.3
        self.default_turn_speed = 0.5
        self.logger = logging.getLogger('control')
        
        # Command mapping
        self.command_map = {
            'Forward': self.move_forward,
            'Right': self.turn_right,
            'Left': self.turn_left,
            'Rotate': self.rotate_in_place,
            'Idle': self.idle
        }

    def idle(self, *_args, **_kwargs):
        """Idle: stand still (no movement)."""
        self.logger.info("• Idle - standing still")
        # Ensure robot is not moving
        self.stop()
    
    def connect(self):
        """Initialize connection to GO2"""
        try:
            if SDK_AVAILABLE:
                # Initialize the channel factory
                ChannelFactoryInitialize(0, "enp2s0")  # Use appropriate network interface
                
                # Create publisher for sport mode commands
                self.publisher = ChannelPublisher("rt/sportmodecommand", SportModeCmd_)
                self.publisher.Init()
                
                time.sleep(0.5)  # Give time for connection
                
                self.connected = True
                self.logger.info("Connected to GO2 robot")
            else:
                # Simulation mode
                self.connected = True
                self.logger.info("Running in SIMULATION mode (SDK not available)")
            
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to connect to GO2: {e}")
            self.connected = False
            return False
    
    def _send_command(self, vx=0.0, vy=0.0, vyaw=0.0):
        """
        Send movement command to robot
        
        Args:
            vx: Forward/backward velocity (m/s) - positive is forward
            vy: Left/right velocity (m/s) - positive is left
            vyaw: Yaw angular velocity (rad/s) - positive is counter-clockwise
        """
        with self.command_lock:
            if not self.connected:
                self.logger.warning("Robot not connected")
                return
            
            if SDK_AVAILABLE and self.publisher:
                try:
                    # Create sport mode command
                    cmd = SportModeCmd_()
                    cmd.mode = 2  # Sport mode
                    cmd.gait_type = 1  # Trot gait
                    cmd.velocity = [vx, vy, vyaw]  # [forward, lateral, yaw]
                    cmd.position = [0.0, 0.0]
                    cmd.body_height = 0.0
                    cmd.foot_raise_height = 0.0
                    
                    # Publish command
                    self.publisher.Write(cmd)
                    
                    # Suppress duplicate simulation logs: only log when command changes
                    self.last_command = (vx, vy, vyaw)
                    self.last_command_time = time.time()
                    
                except Exception as e:
                    self.logger.error(f"Error sending command: {e}")
            else:
                # Simulation mode - log only when command changes
                new_cmd = (vx, vy, vyaw)
                if self.last_command != new_cmd:
                    self.logger.info(f"[SIM] Command: vx={vx:.2f}, vy={vy:.2f}, vyaw={vyaw:.2f}")
                self.last_command = new_cmd
                self.last_command_time = time.time()
    
    def move_forward(self, speed=None):
        """Move forward"""
        if speed is None:
            speed = self.default_forward_speed
        
        self.logger.info(f"→ Moving forward at {speed:.2f} m/s")
        self._send_command(vx=speed, vy=0.0, vyaw=0.0)
    
    def turn_right(self, speed=None):
        """Turn right (rotate clockwise)"""
        if speed is None:
            speed = self.default_turn_speed
        
        self.logger.info(f"↻ Turning right at {speed:.2f} rad/s")
        self._send_command(vx=0.0, vy=0.0, vyaw=-speed)
    
    def turn_left(self, speed=None):
        """Turn left (rotate counter-clockwise)"""
        if speed is None:
            speed = self.default_turn_speed
        
        self.logger.info(f"↺ Turning left at {speed:.2f} rad/s")
        self._send_command(vx=0.0, vy=0.0, vyaw=speed)
    
    def rotate_in_place(self, speed=None):
        """Rotate in place (for down arrow - safer than backing up)"""
        if speed is None:
            speed = self.default_turn_speed
        
        self.logger.info(f"⟳ Rotating in place at {speed:.2f} rad/s")
        # Rotate 180 degrees by spinning in place
        self._send_command(vx=0.0, vy=0.0, vyaw=speed)
    
    def stop(self):
        """Stop all movement"""
        self.logger.info("■ Stopping")
        self._send_command(vx=0.0, vy=0.0, vyaw=0.0)
    
    def emergency_stop(self):
        """Emergency stop - immediately halt all movement"""
        self.logger.critical("!!! EMERGENCY STOP !!!")
        for _ in range(3):  # Send multiple times to ensure it's received
            self._send_command(vx=0.0, vy=0.0, vyaw=0.0)
            time.sleep(0.01)
    
    def execute_command(self, command_name, speed=None):
        """
        Execute a named command
        
        Args:
            command_name: Name of the command (Forward, Right, Left, Rotate)
            speed: Optional speed parameter
        """
        if not self.connected:
            self.logger.warning("Robot not connected")
            return
        
        # Normalize command name
        command_name = command_name.strip().title()
        
        if command_name in self.command_map:
            self.command_map[command_name](speed)
        else:
            self.logger.warning(f"Unknown command: {command_name}")
    
    def disconnect(self):
        """Disconnect from robot"""
        if self.connected:
            self.stop()
            time.sleep(0.1)
            self.connected = False
            self.logger.info("Disconnected from GO2")


# Test script
if __name__ == "__main__":
    import sys
    logger = logging.getLogger('control')
    logger.info("GO2 Controller Test")
    logger.info("%s", "=" * 40)
    
    controller = GO2Controller()
    
    if controller.connect():
        logger.info("\nTesting movements (2 seconds each)...")
        
        # Test forward
        logger.info("\n1. Testing FORWARD")
        controller.move_forward(0.2)
        time.sleep(2)
        controller.stop()
        time.sleep(1)
        
        # Test right turn
        logger.info("\n2. Testing RIGHT turn")
        controller.turn_right(0.3)
        time.sleep(2)
        controller.stop()
        time.sleep(1)
        
        # Test left turn
        logger.info("\n3. Testing LEFT turn")
        controller.turn_left(0.3)
        time.sleep(2)
        controller.stop()
        time.sleep(1)
        
        # Test rotate
        logger.info("\n4. Testing ROTATE in place")
        controller.rotate_in_place(0.4)
        time.sleep(2)
        controller.stop()
        
        logger.info("\n✓ Test complete")
        controller.disconnect()
    else:
        logger.error("Could not connect to robot")
        sys.exit(1)

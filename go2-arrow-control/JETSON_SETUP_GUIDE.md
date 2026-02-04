# Jetson Orin Setup Guide (Single Wi-Fi Interface)

This guide covers setting up a fresh Jetson Orin for the GO2 Arrow Control system.  
**Challenge:** The Jetson Orin typically has only one Wi-Fi interface. It cannot be connected to the Internet and act as a Hotspot simultaneously.
**Solution:** We will connect to the Internet first to install dependencies, then switch the Wi-Fi interface to "Hotspot Mode" for the operation phase.

---

## Phase 0: User & Permissions Check

1.  **User credentials**
    username: bot
    password: ask me

---

## Phase 1: Local Access & Internet
*Prerequisites: Monitor, Keyboard, and Mouse connected to the Jetson Orin.*

1.  **Boot the Jetson** and log in.
2.  **Connect to Wi-Fi** (or Ethernet) to get Internet access.
3.  **Open a Terminal**.

---

## Phase 2: System Setup & SSH
1.  **Update and Install Tools**
    ```bash
    sudo apt update
    sudo apt install -y openssh-server git python3-pip curl network-manager
    ```

2.  **Verify SSH is Running**
    ```bash
    sudo systemctl enable ssh
    sudo systemctl start ssh
    sudo systemctl status ssh
    # You should see "Active: active (running)"
    ```

3.  **SSH Key Exchange (From another Laptop)**
    This allows passwordless login, which is very helpful later.
    1.  **On Jetson**: Find current IP address:
        ```bash
        hostname -I
        # Note the first IP address (e.g., 192.168.1.15)
        ```
    2.  **On Laptop (Linux/Mac)**: Open a terminal and run (replace `192.168.1.15` with Jetson's IP):
        ```bash
        # If you don't have a key yet, generate one:
        # ssh-keygen -t ed25519

        # Copy key to Jetson (you will need the 'bot' password one last time)
        ssh-copy-id bot@192.168.1.15
        ```
    3.  **On Laptop (Windows)**: Open PowerShell and run:
        ```powershell
        # Generate key if needed
        # ssh-keygen -t ed25519

        # Copy key content to Jetson
        type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh bot@192.168.1.15 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
        ```

4.  **Install Miniforge (Recommended for Jetson)**
    Since `conda` is required for the setup script:
    ```bash
    curl -L -O "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-aarch64.sh"
    bash Miniforge3-Linux-aarch64.sh -b
    ~/miniforge3/bin/conda init bash
    source ~/.bashrc
    ```

---

## Phase 3: Install Project Dependencies
*Do this while still connected to the Internet.*

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/your-repo/go2-arrow-control.git
    cd go2-arrow-control
    ```

2.  **Run Setup Script**
    This will create the environment and install Python libraries.
    ```bash
    chmod +x setup.sh
    ./setup.sh
    ```
    *Note: If the script invites you to run `conda activate demo_workshops`, do so.*

## Phase 4: Configure the Wi-Fi Hotspot (The "Tricky" Part)
*We will now configure the Hotspot. Once active, the Jetson will disconnect from the Internet.*

1.  **Identify your Wi-Fi Interface**
    Run the following to find your Wi-Fi device name:
    ```bash
    nmcli device
    # Look for the row with TYPE 'wifi'.
    # IMPORTANT: Your interface might be named 'wlan0', 'wlP1p1s0', or similar.
    # Replace 'YOUR_INTERFACE' in the commands below with this exact name.
    ```

2.  **Define the Hotspot** using `nmcli` (Network Manager CLI).
    Run these commands in the Jetson terminal:

    ```bash
    # Create the connection (interface name is likely wlp1s0 or wlan0)
    sudo nmcli con add type wifi ifname 'YOUR_INTERFACE' con-name Hotspot autoconnect yes ssid GO2_Control_Hub

    # Set mode to Access Point (AP)
    sudo nmcli con modify Hotspot 802-11-wireless.mode ap 802-11-wireless.band bg

    # Set Security (WPA2) and Password
    sudo nmcli con modify Hotspot wifi-sec.key-mgmt wpa-psk wifi-sec.psk "go2demo123"

    # Set a Static IP (Recommended to avoid conflict with USB-Ethernet at 192.168.55.1)
    sudo nmcli con modify Hotspot ipv4.addresses 10.42.0.1/24
    sudo nmcli con modify Hotspot ipv4.gateway 10.42.0.1
    sudo nmcli con modify Hotspot ipv4.method manual

    # [CRITICAL] Set High Priority to ensure it starts instead of searching for home Wi-Fi
    sudo nmcli con modify Hotspot connection.autoconnect-priority 100
    ```

2.  **Switch to Hotspot Mode & Disable Client Wi-Fi**
    *Warning: This will disconnect your current internet connection. Disabling autoconnect on your home Wi-Fi ensures the Jetson doesn't try to switch back.*
    ```bash
    # Replace 'Home_Wifi_Name' with the name of the network you connected to in Phase 1
    sudo nmcli con modify "Home_Wifi_Name" connection.autoconnect no
    
    # Activate the Hotspot immediately
    sudo nmcli con up Hotspot
    ```

3.  **Verify Hotspot**
    Run `ifconfig` or `ip addr show 'YOUR_INTERFACE'`. You should see the IP address `10.42.0.1`.

---

## Phase 5: Remote Connection

1.  **On your Laptop**:
    *   Disconnect from your home Wi-Fi.
    *   Scan for networks.
    *   Connect to **GO2_Control_Hub** with password `go2demo123`.

2.  **SSH into Jetson**:
    Open your laptop terminal (or PowerShell) and run:
    ```bash
    ssh bot@10.42.0.1
    ```

    **Troubleshooting Connection:**
    If you cannot ping/ssh `10.42.0.1`:
    1.  **Check Windows IP**: Open Command Prompt (`cmd`) via `Windows`+`R`, type `ipconfig`.
        *   Look for your Wi-Fi adapter. It *should* have an IP like `10.42.0.X` (assigned by the Jetson's DHCP server, `dnsmasq`).
        *   If it has an "Auto Configuration IP" like `169.254.x.x`, the Jetson's DHCP server failed or isn't running.
    2.  **Set Static IP on Windows (Workaround)**:
        *   Go to **Network Connections** > Right-click Wi-Fi > **Properties**.
        *   Select **IPv4** > **Properties**.
        *   Select **Use the following IP address**:
            *   IP Address: `10.42.0.5`
            *   Subnet mask: `255.255.255.0`
            *   Default gateway: `10.42.0.1`
    3.  **Firewall**: Ensure Windows Firewall isn't blocking the connection (try temporarily disabling it for "Public" networks if the Hotspot is detected as public).

---

## Phase 7: Emergency Rescue & Recovery

**If your Jetson gets stuck in a boot loop or "Emergency Mode" after network changes:**

1.  Connect a monitor and keyboard.
2.  Press **Enter** to access the maintenance shell.
3.  Run the following commands to delete the faulty network configuration:
    ```bash
    # 1. Mount disk as writable
    mount -o remount,rw /

    # 2. Go to connection configs
    cd /etc/NetworkManager/system-connections/

    # 3. List files (Look for Hotspot.nmconnection)
    ls

    # 4. Delete the hotspot config
    rm Hotspot.nmconnection

    # 5. Reboot
    reboot
    ```

**If you see "Failed to Mount" errors:**
This often happens if the device was unplugged abruptly, causing disk corruption.
1.  In emergency shell, find your root partition name:
    ```bash
    lsblk
    # Look for the largest partition mounted at "/" (e.g., /dev/mmcblk0p1 or /dev/nvme0n1p1)
    ```
2.  **Run a filesystem check**:
    If you get **"Resource Busy"** when trying to unmount, it means you are currently using that disk.
    *   **Option A (Remount Read-Only)**:
        ```bash
        mount -o remount,ro /
        fsck -y /dev/nvme0n1p1  # Replace with your drive partition
        ```
    *   **Option B (Force Check on Reboot)**:
        If you can write to the disk (see step 3 below), run:
        ```bash
        touch /forcefsck
        reboot
        ```
3.  **Check /etc/fstab**:
    Sometimes network drives, old Snap partitions, or bad entries block booting.
    ```bash
    nano /etc/fstab
    # Comment out (add #) to any lines that aren't the main system partitions (mmcblk/nvme).
    # ESPECIALLY looks for lines mentioning 'snap', 'overlay', or 'loop'.
    # CRITICAL: Do NOT comment out the line for '/' (Root) or '/boot/efi'.
    
    # To find which UUID is real, run:
    blkid
    # Compare the UUID of /dev/nvme0n1p1 (or mmcblk0p1) with what is in fstab.
    # Ensure the line matching your main disk's UUID is NOT commented out.
    ```
4.  Reboot.

**If you see "Failed to start Dispatcher daemon" after editing fstab:**
You likely commented out the **Root Filesystem** entry by mistake.
1.  Run `blkid` to get the true UUID of your main partition.
2.  Edit `nano /etc/fstab` and **uncomment** the line with that matching UUID.
3.  Reboot.
If you see `SELinux getfileicon_raw() failed`, ignore it. This is a **symptom** of the disk being Read-Only due to the mount failure above. It will disappear once the disk is fixed.

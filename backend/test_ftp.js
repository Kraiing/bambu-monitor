const ftpClient = require('./ftpClient');
const fs = require('fs');

const printerIP = '192.168.1.134'; // Assuming this is the IP from earlier connection
const accessCode = '25597793'; // Update this if needed, or I can read it from config.json

async function listAll() {
    try {
        console.log('Reading config...');
        const configRaw = fs.readFileSync('../config.json', 'utf-8');
        const config = JSON.parse(configRaw);

        const ip = config.printerIP;
        const code = config.accessCode;
        console.log(`Testing FTP with IP: ${ip}`);

        const mode = 'ftps990';

        console.log('\n--- /cache/ ---');
        const cacheFiles = await ftpClient.listFiles({ printerIP: ip, accessCode: code, mode, dir: '/cache/' });
        console.log(cacheFiles.map(f => f.name).join('\n'));

        console.log('\n--- /sdcard/ ---');
        const sdFiles = await ftpClient.listFiles({ printerIP: ip, accessCode: code, mode, dir: '/sdcard/' });
        console.log(sdFiles.map(f => f.name).slice(0, 30).join('\n') + (sdFiles.length > 30 ? '\n... and more' : ''));

    } catch (e) {
        console.error('Error:', e.message);
    }
}

listAll();

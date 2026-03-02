const { Client } = require('basic-ftp');
const AdmZip = require('adm-zip');
const fs = require('fs');
const readline = require('readline');
const stream = require('stream');
const config = require('./config.json');

async function run() {
    const client = new Client();
    try {
        await client.access({
            host: config.printerIP,
            user: "bblp",
            password: config.accessCode,
            port: 990,
            secure: 'implicit',
            secureOptions: { rejectUnauthorized: false }
        });

        console.log("Connected to FTP. Listing / ...");
        const files = await client.list('/');
        const target = files.find(f => f.name.endsWith('.3mf'));

        if (!target) {
            console.log("No .3mf found in root.");
            return;
        }

        console.log(`Downloading ${target.name}...`);
        const chunks = [];
        const writable = new stream.Writable({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await client.downloadTo(writable, `/${target.name}`);
        client.close();

        const buffer = Buffer.concat(chunks);
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const gcodeEntry = entries.find(e => e.entryName.endsWith('.gcode') && !e.isDirectory);

        if (!gcodeEntry) {
            console.log("No gcode in 3mf");
            return;
        }

        const gcodeText = gcodeEntry.getData().toString('utf-8');
        console.log("Extracting object tags...");

        const lines = gcodeText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Check for exclude tags or object tags
            if (line.includes('EXCLUDE') || line.includes('OBJECT') || line.includes('object') || line.includes('id:') || line.includes('id =')) {
                if (line.trim().startsWith(';')) {
                    console.log(`Line ${i}: ${line.trim()}`);
                }
            }
        }

        console.log("Done checking first 3MF file.");
    } catch (err) {
        console.error(err);
        client.close();
    }
}
run();

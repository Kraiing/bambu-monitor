const { Client } = require('basic-ftp');
const config = require('./config.json');

async function listDirRecX(ftp, dir, depth = 0) {
    if (depth > 2) return;
    try {
        const files = await ftp.list(dir);
        for (const file of files) {
            console.log("  ".repeat(depth) + file.name + (file.isDirectory ? '/' : ` (${file.size} bytes)`));
            if (file.isDirectory) {
                await listDirRecX(ftp, `${dir}/${file.name}`, depth + 1);
            }
        }
    } catch (e) {
        console.log("  ".repeat(depth) + `Error listing ${dir}:`, e.message);
    }
}

async function run() {
    const client = new Client();
    client.ftp.verbose = false;
    try {
        await client.access({
            host: config.printerIP,
            user: "bblp",
            password: config.accessCode,
            port: 990,
            secure: true,
            secureOptions: { rejectUnauthorized: false }
        });
        console.log("Connected to FTP!");
        await listDirRecX(client, '/');
    } catch (err) {
        console.error("Connection failed", err);
    }
    client.close();
}

run();

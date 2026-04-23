import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const frontendDir = path.resolve(path.dirname(__filename), '..');
const projectRoot = path.resolve(frontendDir, '..');
const backendDir = path.join(projectRoot, 'backend');

const BACKEND_HOST = process.env.WEBNAM_BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.WEBNAM_BACKEND_PORT || 8003);
const STARTUP_TIMEOUT_MS = Number(process.env.WEBNAM_BACKEND_STARTUP_TIMEOUT_MS || 15000);
const POLL_INTERVAL_MS = 350;

const windowsPhpCandidates = [
    path.join(projectRoot, 'php84', 'php.exe'),
    'C:\\xampp\\php\\php.exe',
];

const isPortOpen = (host, port) => new Promise((resolve) => {
    const socket = new net.Socket();

    const finalize = (value) => {
        socket.destroy();
        resolve(value);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
    socket.connect(port, host);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolvePhpCommand = () => {
    if (process.platform === 'win32') {
        return windowsPhpCandidates.find((candidate) => fs.existsSync(candidate)) || 'php';
    }

    return 'php';
};

const waitForBackend = async () => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (await isPortOpen(BACKEND_HOST, BACKEND_PORT)) {
            return true;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    return false;
};

const startBackendIfNeeded = async () => {
    if (process.env.WEBNAM_SKIP_BACKEND_BOOT === '1') {
        return;
    }

    if (await isPortOpen(BACKEND_HOST, BACKEND_PORT)) {
        return;
    }

    const phpCommand = resolvePhpCommand();
    const args = ['-S', `${BACKEND_HOST}:${BACKEND_PORT}`, '-t', 'public', 'public/index.php'];
    const backendProcess = spawn(phpCommand, args, {
        cwd: backendDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
    });

    backendProcess.unref();

    const ready = await waitForBackend();
    if (!ready) {
        throw new Error(`Backend did not start on ${BACKEND_HOST}:${BACKEND_PORT} within ${STARTUP_TIMEOUT_MS}ms.`);
    }
};

const startVite = async () => {
    await startBackendIfNeeded();

    const viteBinary = path.join(frontendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
    const viteArgs = process.argv.slice(2);
    const viteProcess = spawn(viteBinary, viteArgs, {
        cwd: frontendDir,
        stdio: 'inherit',
        windowsHide: false,
        shell: process.platform === 'win32',
    });

    viteProcess.on('error', (error) => {
        console.error('[webnam-dev]', error instanceof Error ? error.message : error);
        process.exit(1);
    });

    viteProcess.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }

        process.exit(code ?? 0);
    });
};

startVite().catch((error) => {
    console.error('[webnam-dev]', error instanceof Error ? error.message : error);
    process.exit(1);
});

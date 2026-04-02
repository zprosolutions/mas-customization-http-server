'use strict';

const express = require('express');
const fileUpload = require('express-fileupload');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const STORE_DIR = path.join(__dirname, process.env.STORE_DIRECTORY || 'store');
const MAX_FILE_SIZE = parseSize(process.env.MAX_FILE_SIZE || '5GB');

// URLs used for "copy path" feature
// INTERNAL_BASE_URL: HTTP URL of the in-cluster Service (Maximo uses this)
//   e.g. http://mas-file-server.mas-core.svc.cluster.local:8080
// EXTERNAL_BASE_URL: HTTPS URL of the OpenShift Route (browser access)
//   e.g. https://mas-file-server-route-mas-core.apps.cluster.example.com
const INTERNAL_BASE_URL = (process.env.INTERNAL_BASE_URL || '').replace(/\/$/, '');
const EXTERNAL_BASE_URL = (process.env.EXTERNAL_BASE_URL || '').replace(/\/$/, '');

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseSize(str) {
    const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
    const m = String(str).toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
    if (!m) return 5 * 1024 ** 3;
    return Math.floor(parseFloat(m[1]) * (units[m[2] || 'b'] || 1));
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / 1024 ** i).toFixed(2).replace(/\.?0+$/, '') + ' ' + units[i];
}

function safeFilename(name) {
    // Reject path traversal
    return path.basename(name) === name && !name.includes('\0');
}

async function listFiles(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        if (!e.isFile()) continue;
        const stat = await fs.promises.stat(path.join(dir, e.name));
        files.push({ name: e.name, size: stat.size, uploadDate: stat.mtime });
    }
    return files.sort((a, b) => b.uploadDate - a.uploadDate);
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(fileUpload({ limits: { fileSize: MAX_FILE_SIZE } }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure store directory exists
fs.mkdirSync(STORE_DIR, { recursive: true });

// Serve stored files directly (HTTP, no directory listing)
app.use('/store', express.static(STORE_DIR));

// ── API: config (used by frontend for copy-path buttons) ──────────────────────
app.get('/api/config', (req, res) => {
    res.json({ internalBaseUrl: INTERNAL_BASE_URL, externalBaseUrl: EXTERNAL_BASE_URL });
});

// ── API: list files with pagination ──────────────────────────────────────────
app.get('/api/files', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const page = Math.max(parseInt(req.query.page) || 1, 1);

        const all = await listFiles(STORE_DIR);
        const totalFiles = all.length;
        const totalSize = all.reduce((s, f) => s + f.size, 0);
        const totalPages = Math.max(Math.ceil(totalFiles / limit), 1);
        const start = (page - 1) * limit;
        const files = all.slice(start, start + limit);

        res.json({
            files,
            pagination: {
                currentPage: page,
                totalPages,
                totalFiles,
                totalSize,
                filesPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── API: upload ───────────────────────────────────────────────────────────────
app.post('/api/upload', async (req, res) => {
    if (!req.files || !req.files.target_file) {
        return res.status(400).json({ error: 'No file provided' });
    }

    let uploads = req.files.target_file;
    if (!Array.isArray(uploads)) uploads = [uploads];

    const results = [];
    for (const file of uploads) {
        if (!safeFilename(file.name)) {
            results.push({ filename: file.name, success: false, error: 'Invalid filename' });
            continue;
        }
        try {
            await file.mv(path.join(STORE_DIR, file.name));
            results.push({ filename: file.name, success: true });
        } catch (err) {
            results.push({ filename: file.name, success: false, error: err.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const status = successCount < uploads.length ? 207 : 200;
    res.status(status).json({
        success: status === 200,
        message: `Uploaded ${successCount} of ${uploads.length} file(s)`,
        results
    });
});

// ── API: delete ───────────────────────────────────────────────────────────────
app.post('/api/delete', async (req, res) => {
    const { files } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'No files specified' });
    }

    const results = [];
    for (const name of files) {
        if (!safeFilename(name)) {
            results.push({ filename: name, success: false, error: 'Invalid filename' });
            continue;
        }
        try {
            await fs.promises.unlink(path.join(STORE_DIR, name));
            results.push({ filename: name, success: true });
        } catch (err) {
            results.push({ filename: name, success: false, error: err.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    const status = successCount < files.length ? 207 : 200;
    res.status(status).json({ success: status === 200, message: `Deleted ${successCount} file(s)`, results });
});

// ── API: download single ──────────────────────────────────────────────────────
app.get('/api/download/:filename', (req, res) => {
    const name = req.params.filename;
    if (!safeFilename(name)) return res.status(400).json({ error: 'Invalid filename' });
    const filePath = path.join(STORE_DIR, name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
});

// ── API: bulk download as ZIP ─────────────────────────────────────────────────
app.post('/api/download-bulk', (req, res) => {
    const { files } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'No files specified' });
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    res.attachment(`zpro-files-${timestamp}.zip`);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    archive.on('error', err => { if (!res.headersSent) res.status(500).end(); console.error(err); });

    let added = 0;
    for (const name of files) {
        if (!safeFilename(name)) continue;
        const fp = path.join(STORE_DIR, name);
        if (fs.existsSync(fp)) { archive.file(fp, { name }); added++; }
    }

    if (added === 0) return res.status(404).json({ error: 'None of the specified files were found' });
    archive.finalize();
});

// ── 404 / Error ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    console.log(`ZPro File Server listening on ${HOST}:${PORT}`);
    console.log(`Store: ${STORE_DIR}`);
    if (INTERNAL_BASE_URL) console.log(`Internal base URL: ${INTERNAL_BASE_URL}`);
    if (EXTERNAL_BASE_URL) console.log(`External base URL: ${EXTERNAL_BASE_URL}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

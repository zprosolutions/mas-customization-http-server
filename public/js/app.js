/* ZPro File Server – Frontend */

const state = {
    filesVisible: false,
    currentPage: 1,
    itemsPerPage: 10,
    paginationData: null,
    uploadInProgress: false,
    internalBaseUrl: '',
    externalBaseUrl: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const cfg = await fetch('/api/config').then(r => r.json());
        state.internalBaseUrl = cfg.internalBaseUrl || '';
        state.externalBaseUrl = cfg.externalBaseUrl || '';
    } catch (_) {}
});

// ── Modal ─────────────────────────────────────────────────────────────────────
function openUploadModal() {
    document.getElementById('uploadModal').style.display = 'block';
}

function closeUploadModal() {
    if (state.uploadInProgress && !confirm('Upload in progress. Close anyway?')) return;
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    document.getElementById('progressContainer').classList.remove('active');
    document.getElementById('progressList').innerHTML = '';
    document.getElementById('selectedFilesInfo').style.display = 'none';
    document.getElementById('uploadSummary').style.display = 'none';
    state.uploadInProgress = false;
}

window.onclick = e => {
    const modal = document.getElementById('uploadModal');
    if (e.target === modal && !state.uploadInProgress) closeUploadModal();
};

function goToListFiles() {
    closeUploadModal();
    if (!state.filesVisible) toggleFileList();
}

// ── File input display ────────────────────────────────────────────────────────
function updateFileCount() {
    const input = document.getElementById('fileInput');
    const info  = document.getElementById('selectedFilesInfo');
    if (input.files.length > 0) {
        const total = Array.from(input.files).reduce((s, f) => s + f.size, 0);
        info.textContent = `${input.files.length} file(s) selected (${formatFileSize(total)})`;
        info.style.display = 'block';
    } else {
        info.style.display = 'none';
    }
}

// ── Messages ──────────────────────────────────────────────────────────────────
function showMessage(text, type) {
    const container = document.getElementById('messageContainer');
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    container.innerHTML = '';
    container.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadFiles(event) {
    event.preventDefault();
    const files = Array.from(document.getElementById('fileInput').files);
    if (files.length === 0) { showMessage('Please select at least one file', 'error'); return; }

    const progressContainer = document.getElementById('progressContainer');
    const progressList = document.getElementById('progressList');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSummary = document.getElementById('uploadSummary');

    progressContainer.classList.add('active');
    progressList.innerHTML = '';
    uploadBtn.disabled = true;
    state.uploadInProgress = true;
    uploadSummary.style.display = 'none';

    const bars = {};
    files.forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'file-progress-item';
        item.innerHTML = `
            <div class="file-progress-name">${file.name} (${formatFileSize(file.size)})</div>
            <div class="progress-bar"><div class="progress-fill" id="prog-${i}">0%</div></div>`;
        progressList.appendChild(item);
        bars[i] = document.getElementById(`prog-${i}`);
    });

    const results = [];
    for (let i = 0; i < files.length; i++) {
        const fd = new FormData();
        fd.append('target_file', files[i]);
        try {
            await uploadSingleFile(fd, bars[i]);
            results.push({ success: true });
        } catch {
            results.push({ success: false });
        }
    }

    state.uploadInProgress = false;
    uploadBtn.disabled = false;

    const ok = results.filter(r => r.success).length;
    const fail = results.length - ok;
    const cls = fail > 0 ? 'partial' : 'success';
    const msg = fail > 0 ? `Uploaded ${ok} file(s), ${fail} failed` : `Successfully uploaded ${ok} file(s)`;
    uploadSummary.className = `upload-summary ${cls}`;
    uploadSummary.textContent = msg;
    uploadSummary.style.display = 'block';
    showMessage(msg, fail > 0 ? 'error' : 'success');

    if (state.filesVisible) setTimeout(loadFiles, 1000);
}

function uploadSingleFile(formData, bar) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
            if (e.lengthComputable) {
                const pct = Math.round(e.loaded / e.total * 100);
                bar.style.width = pct + '%';
                bar.textContent = pct + '%';
            }
        });
        xhr.addEventListener('load', () => {
            if (xhr.status === 200 || xhr.status === 207) {
                bar.style.width = '100%';
                bar.textContent = 'Done';
                bar.classList.add('complete');
                resolve();
            } else {
                bar.style.width = '100%';
                bar.textContent = 'Failed';
                bar.classList.add('error');
                reject(new Error('Upload failed'));
            }
        });
        xhr.addEventListener('error', () => {
            bar.textContent = 'Error';
            bar.classList.add('error');
            reject(new Error('Network error'));
        });
        xhr.open('POST', '/api/upload');
        xhr.send(formData);
    });
}

// ── File list ─────────────────────────────────────────────────────────────────
async function toggleFileList() {
    state.filesVisible = !state.filesVisible;
    const section = document.getElementById('fileListSection');
    if (state.filesVisible) {
        section.classList.add('visible');
        state.currentPage = 1;
        await loadFiles();
    } else {
        section.classList.remove('visible');
    }
}

async function loadFiles() {
    const container = document.getElementById('fileListContainer');
    container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading files...</div>';

    try {
        const data = await fetch(`/api/files?page=${state.currentPage}&limit=${state.itemsPerPage}`).then(r => r.json());
        state.paginationData = data.pagination;

        updateSummary(data.pagination);

        if (data.pagination.totalFiles === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                        <polyline points="13 2 13 9 20 9"/>
                    </svg>
                    <h3>No files uploaded yet</h3>
                    <p>Click "Upload Files" to get started</p>
                </div>`;
            document.getElementById('summarySection').style.display = 'none';
            document.getElementById('paginationControls').style.display = 'none';
            return;
        }

        document.getElementById('paginationControls').style.display = 'flex';

        let html = '<div class="file-list">';
        for (const file of data.files) {
            const date = new Date(file.uploadDate);
            const enc  = encodeURIComponent(file.name);
            const copyBtns = buildCopyButtons(file.name);

            html += `
            <div class="file-item">
                <input type="checkbox" class="file-checkbox" value="${file.name}" onchange="updateActionButtons()">
                <div class="file-info">
                    <div class="file-name">${escHtml(file.name)}</div>
                    <div class="file-meta">${date.toLocaleDateString()} ${date.toLocaleTimeString()} &nbsp;|&nbsp; ${formatFileSize(file.size)}</div>
                    ${copyBtns}
                </div>
                <div class="file-actions">
                    <button class="btn-icon btn-download-single" onclick="downloadSingleFile('${enc}')" title="Download">&#8595;</button>
                    <button class="btn-icon btn-delete-single"   onclick="deleteSingleFile('${enc}')"   title="Delete">&#10005;</button>
                </div>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;
        updatePaginationButtons();
    } catch (err) {
        container.innerHTML = `<div class="message error">Failed to load files: ${err.message}</div>`;
    }
}

function buildCopyButtons(filename) {
    const enc = encodeURIComponent(filename);
    let html = '<div class="copy-paths">';
    if (state.internalBaseUrl) {
        const url = `${state.internalBaseUrl}/store/${enc}`;
        html += `<button class="btn-copy" onclick="copyPath(this,'${escAttr(url)}')" title="${escAttr(url)}">Copy Internal HTTP Path</button>`;
    }
    if (state.externalBaseUrl) {
        const url = `${state.externalBaseUrl}/store/${enc}`;
        html += `<button class="btn-copy" onclick="copyPath(this,'${escAttr(url)}')" title="${escAttr(url)}">Copy External HTTPS Path</button>`;
    }
    html += '</div>';
    return html;
}

function copyPath(btn, url) {
    navigator.clipboard.writeText(url).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    }).catch(() => {
        // fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    });
}

// ── Summary & Pagination ──────────────────────────────────────────────────────
function updateSummary(p) {
    document.getElementById('summarySection').style.display = 'grid';
    document.getElementById('totalFilesCount').textContent = p.totalFiles;
    document.getElementById('totalFilesSize').textContent  = formatFileSize(p.totalSize);
    const from = Math.min((p.currentPage - 1) * p.filesPerPage + 1, p.totalFiles);
    const to   = Math.min(p.currentPage * p.filesPerPage, p.totalFiles);
    document.getElementById('currentPageFiles').textContent = `${from}–${to}`;
}

function updatePaginationButtons() {
    const p = state.paginationData;
    document.getElementById('prevBtn').disabled = !p.hasPrevPage;
    document.getElementById('nextBtn').disabled = !p.hasNextPage;
    document.getElementById('pageInfo').textContent = `Page ${p.currentPage} of ${p.totalPages}`;
}

function previousPage() { if (state.currentPage > 1) { state.currentPage--; loadFiles(); } }
function nextPage()     { if (state.paginationData && state.currentPage < state.paginationData.totalPages) { state.currentPage++; loadFiles(); } }
function changeItemsPerPage() { state.itemsPerPage = parseInt(document.getElementById('itemsPerPage').value); state.currentPage = 1; loadFiles(); }

// ── Action buttons ────────────────────────────────────────────────────────────
function updateActionButtons() {
    const any = document.querySelectorAll('.file-checkbox:checked').length > 0;
    document.getElementById('deleteBtn').disabled   = !any;
    document.getElementById('downloadBtn').disabled = !any;
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteSelectedFiles() {
    const files = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(c => c.value);
    if (!files.length || !confirm(`Delete ${files.length} file(s)?`)) return;
    await _deleteFiles(files);
}

async function deleteSingleFile(enc) {
    const name = decodeURIComponent(enc);
    if (!confirm(`Delete "${name}"?`)) return;
    await _deleteFiles([name]);
}

async function _deleteFiles(files) {
    try {
        const r = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
        const d = await r.json();
        if (r.ok || r.status === 207) {
            const ok = d.results.filter(x => x.success).length;
            showMessage(`Deleted ${ok} file(s)`, 'success');
            await loadFiles();
        } else {
            showMessage(`Delete failed: ${d.error}`, 'error');
        }
    } catch (err) {
        showMessage(`Delete failed: ${err.message}`, 'error');
    }
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadSingleFile(enc) {
    window.location.href = `/api/download/${enc}`;
}

async function downloadSelectedFiles() {
    const files = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(c => c.value);
    if (!files.length) return;
    showMessage(`Preparing download of ${files.length} file(s)...`, 'success');
    try {
        const r = await fetch('/api/download-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
        if (!r.ok) { const e = await r.json(); showMessage(`Download failed: ${e.error}`, 'error'); return; }
        const blob = await r.blob();
        const cd   = r.headers.get('Content-Disposition') || '';
        const m    = cd.match(/filename[^;=\n]*=["']?([^"';\n]*)["']?/);
        const name = m ? m[1].trim() : 'zpro-files.zip';
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: name, style: 'display:none' });
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showMessage(`Downloaded ${files.length} file(s) as ${name}`, 'success');
    } catch (err) {
        showMessage(`Download failed: ${err.message}`, 'error');
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / 1024 ** i).toFixed(2).replace(/\.?0+$/, '') + ' ' + units[i];
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
    return s.replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

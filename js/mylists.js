// ---------- 我的词表：词典管理 ----------
// 词典目录：在此扩展多本词典（id 唯一、name/desc 用于展示）
const DICT_CATALOG = [
    { id: 'ecdict', name: 'ECDICT 英汉词典', desc: 'ECDICT 开源英汉词典：音标 / 释义 / 词性 / 词频 / 同根词等' }
];

let _mylistsBusy = false;

// 渲染词典列表：未下载 → 仅可下载；已下载 → 仅可删除
async function renderDictList() {
    const container = document.getElementById('dictList');
    if (!container) return;
    const loaded = await isDictLoaded();
    container.innerHTML = DICT_CATALOG.map(dict => {
        const done = loaded;
        return '<div class="dict-row">' +
            '  <div class="dict-info">' +
            '    <span class="dict-name">' + escapeHtml(dict.name) + '</span>' +
            '    <span class="dict-desc">' + escapeHtml(dict.desc) + '</span>' +
            '  </div>' +
            '  <span class="dict-status' + (done ? ' ok' : '') + '">' + (done ? '已下载' : '未下载') + '</span>' +
            '  <div class="dict-actions">' +
            '    <button class="primary" ' + (done ? 'disabled' : '') + ' onclick="downloadDict()">下载</button>' +
            '    <button class="danger" ' + (done ? '' : 'disabled') + ' onclick="deleteDict()">删除</button>' +
            '  </div>' +
            '</div>';
    }).join('');
}

// 下载并导入词典（复用 common.js 的导入链路，含进度提示）
async function downloadDict() {
    if (_mylistsBusy) return;
    _mylistsBusy = true;
    setBusy(true, '正在下载并导入词典（约需 1-3 分钟），请勿关闭页面...');
    try {
        await autoImportDictFromCSV();
        if (await isDictLoaded()) {
            showToast('词典下载完成', 'success');
        } else {
            showToast('下载失败：未能获取词典文件，请检查网络后重试', 'error');
        }
    } catch (e) {
        console.warn('下载词典失败', e);
        showToast('下载失败：' + e.message, 'error');
    } finally {
        _mylistsBusy = false;
        setBusy(false);
        await renderDictList();
    }
}

// 删除已下载的词典（删除 IndexedDB 词典库）
function deleteDict() {
    if (_mylistsBusy) return;
    showConfirm('确定删除已下载的词典吗？删除后需重新下载才能查词。', async () => {
        _mylistsBusy = true;
        setBusy(true, '正在删除词典...');
        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(DICT_DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('词典库删除被阻塞，请先关闭其他页面再试'));
            });
            window.dictLoaded = false;
            if (window.dictData) window.dictData.clear();
            showToast('词典已删除', 'success');
        } catch (e) {
            console.warn('删除词典失败', e);
            showToast('删除失败：' + e.message, 'error');
        } finally {
            _mylistsBusy = false;
            setBusy(false);
            await renderDictList();
        }
    });
}

// 忙时禁用全部按钮并显示提示
function setBusy(busy, text) {
    const tip = document.getElementById('dictBusyTip');
    if (tip) {
        tip.textContent = busy ? text : '';
        tip.style.display = busy ? 'block' : 'none';
    }
    document.querySelectorAll('#dictList button').forEach(b => { b.disabled = true; });
}

document.addEventListener('DOMContentLoaded', async () => {
    await renderDictList();
    window.addEventListener('dictReady', async () => { await renderDictList(); });
});

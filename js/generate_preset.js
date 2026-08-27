// 本地脚本：解析 ecdict.csv，按 tag 分类生成预设词表静态文件
// 运行：node generate_preset.js
const fs = require('fs');
const path = require('path');

function parseCSV(text) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else { field += c; }
        } else {
            if (c === '"') { inQuotes = true; }
            else if (c === ',') { cur.push(field); field = ''; }
            else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
            else if (c === '\r') { /* ignore */ }
            else { field += c; }
        }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows;
}

const TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre'];
const TAG_NAMES = {
    'zk': '中考',
    'gk': '高考',
    'cet4': '大学英语四级',
    'cet6': '大学英语六级',
    'ky': '考研',
    'ielts': '雅思',
    'toefl': '托福',
    'gre': '美国研究生入学考试'
};

const csvPath = path.join(__dirname, '..', 'data', 'ecdict.csv');
console.log('读取 ecdict.csv...');
const text = fs.readFileSync(csvPath, 'utf8');
console.log('解析 CSV...');
const rows = parseCSV(text);
const headers = rows[0].map(h => h.trim());
const wordIdx = headers.indexOf('word');
const transIdx = headers.indexOf('translation');
const tagIdx = headers.indexOf('tag');

const tagMap = {};
TAGS.forEach(t => tagMap[t] = []);

console.log('按 tag 分类中...');
for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const word = row[wordIdx];
    const translation = row[transIdx] || '';
    const tag = row[tagIdx] || '';
    if (!word || !tag) continue;
    const tags = tag.split(/\s+/);
    tags.forEach(t => {
        if (tagMap[t]) {
            tagMap[t].push({ word, translation });
        }
    });
}

const result = TAGS.map(t => ({
    tag: t,
    name: TAG_NAMES[t],
    count: tagMap[t].length,
    words: tagMap[t]
}));

console.log('\n生成结果：');
result.forEach(r => console.log('  ' + r.name + ': ' + r.count + ' 词'));

const totalWords = result.reduce((s, r) => s + r.count, 0);
console.log('\n总计: ' + totalWords + ' 词条（含重复）');

const output = 'window.PRESET_LISTS = ' + JSON.stringify(result) + ';';
const outPath = path.join(__dirname, '..', 'data', 'preset_data.js');
fs.writeFileSync(outPath, output, 'utf8');
const fileSize = (fs.statSync(outPath).size / 1048576).toFixed(2);
console.log('\n已保存到 preset_data.js (' + fileSize + ' MB)');

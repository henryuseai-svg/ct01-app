'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MAX_TV = 10;
const TEMPLATE_URL = 'templates/CT01.docx';

/* ---------- IndexedDB ---------- */
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open('ct01', 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    db.createObjectStore('phieu', { keyPath: 'id' });
    db.createObjectStore('congdan', { keyPath: 'cc' });
    db.createObjectStore('settings');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
function tx(store, mode, fn) {
  return dbp.then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
const db = {
  all: s => tx(s, 'readonly', st => st.getAll()),
  get: (s, k) => tx(s, 'readonly', st => st.get(k)),
  put: (s, v, k) => tx(s, 'readwrite', st => k === undefined ? st.put(v) : st.put(v, k)),
  del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
};

/* ---------- Tiện ích ---------- */
function toast(msg, ok = false) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.classList.toggle('ok', ok);
  const host = $('dialog[open]') || document.body; // hộp thoại đang mở nằm trên cùng -> đặt thông báo vào trong nó
  if (t.parentNode !== host) host.append(t);
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2500);
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '').normalize('NFC').trim();
const fold = s => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
function fmtDateInput(v) { // gõ 01011990 -> 01/01/1990
  const d = v.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- QR căn cước ---------- */
// Định dạng: CCCD|CMND cũ|Họ tên|Ngày sinh ddmmyyyy|Giới tính|Nơi thường trú|Ngày cấp ddmmyyyy
function parseCCCD(raw) {
  const p = norm(raw).split('|').map(s => s.trim());
  if (p.length < 6 || !/^\d{12}$/.test(p[0])) return null;
  const d = s => /^\d{8}$/.test(s) ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}` : s;
  return { cc: p[0], cmnd: p[1], ten: p[2], ns: d(p[3]), gt: p[4], diaChi: p[5], ngayCap: d(p[6] || '') };
}

/* ---------- Form ---------- */
let current = null; // phiếu đang mở (null = mới)

function tvHTML(i) {
  return `<div class="tv" data-tv="${i}">
    <div class="card-head"><h2>Thành viên ${i + 1}</h2>
      <span><button class="btn scan" data-scan="tv.${i}">📷 Quét / Tìm</button>
      <button class="btn ghost small danger" data-del-tv="${i}">Xoá</button></span></div>
    <label>Họ, chữ đệm và tên<input data-k="tv.${i}.ten"></label>
    <div class="row">
      <label>Ngày sinh<input data-k="tv.${i}.ns" class="date" placeholder="dd/mm/yyyy" inputmode="numeric"></label>
      <label>Giới tính<select data-k="tv.${i}.gt"><option></option><option>Nam</option><option>Nữ</option></select></label>
    </div>
    <div class="row">
      <label>Số định danh<input data-k="tv.${i}.cc" class="cc" maxlength="12" inputmode="numeric"></label>
      <label>Quan hệ với chủ hộ<input data-k="tv.${i}.qh" list="dl-qh"></label>
    </div>
  </div>`;
}
function renderTV(list) {
  $('#tv-list').innerHTML = list.map((_, i) => tvHTML(i)).join('');
  list.forEach((tv, i) => ['ten', 'ns', 'gt', 'cc', 'qh'].forEach(k => { $(`[data-k="tv.${i}.${k}"]`).value = tv[k] || ''; }));
  $('#tv-count').textContent = `${list.length}/${MAX_TV}`;
  $('#btn-add-tv').hidden = list.length >= MAX_TV;
}
function readForm() {
  const f = { td: {}, ch: {}, tv: [] };
  $$('#tab-form [data-k]').forEach(el => {
    const path = el.dataset.k.split('.'); const v = norm(el.value);
    if (path[0] === 'tv') { (f.tv[+path[1]] ||= {})[path[2]] = v; }
    else if (path.length === 2) f[path[0]][path[1]] = v;
    else f[path[0]] = v;
  });
  return f;
}
function fillForm(f) {
  $$('#tab-form [data-k]:not([data-k^="tv."])').forEach(el => {
    const [a, b] = el.dataset.k.split('.');
    el.value = (b ? f[a]?.[b] : f[a]) || '';
  });
  renderTV(f.tv || []);
  validateAll();
}
async function newForm() {
  current = null;
  const coQuan = (await db.get('settings', 'coQuan')) || '';
  fillForm({ coQuan, ngayNop: todayISO(), td: {}, ch: {}, tv: [] });
  markMissing([]); lastSavedJSON = null;
  $('#form-status').textContent = 'Phiếu mới';
}
function openForm(p) {
  current = p;
  fillForm(p.f);
  markMissing([]); lastSavedJSON = JSON.stringify(readForm());
  $('#form-status').textContent = 'Đang sửa phiếu: ' + (p.f.td.ten || '(chưa có tên)');
  showTab('form');
  scrollTo(0, 0);
}
function setPerson(target, person) {
  const pre = target + '.';
  const filled = [];
  const set = (k, v) => { const el = $(`[data-k="${pre}${k}"]`); if (el && v) { el.value = v; filled.push(el); } };
  set('ten', person.ten); set('cc', person.cc);
  if (target !== 'ch') { set('ns', person.ns); set('gt', person.gt); }
  if (target === 'td') set('sdt', person.sdt);
  validateAll();
  return filled;
}
function validate(el) {
  let ok = true;
  if (el.classList.contains('cc')) ok = !el.value || /^\d{12}$/.test(el.value);
  if (el.classList.contains('date')) ok = !el.value || /^\d{2}\/\d{2}\/\d{4}$/.test(el.value);
  el.classList.toggle('invalid', !ok);
  return ok;
}
const validateAll = () => $$('#tab-form input.cc, #tab-form input.date').map(validate).every(Boolean);

// Số thứ 4 của số định danh: 0 hoặc chẵn = Nam, lẻ = Nữ
const genderFromCC = cc => /^\d{4}/.test(cc) ? (+cc[3] % 2 === 0 ? 'Nam' : 'Nữ') : '';

/* ---------- Bắt buộc: mục 1–10 (trừ 5, 6) và đủ thông tin mỗi thành viên có nhập ---------- */
function missingFields(f) {
  const miss = [];
  const need = (v, key, label) => { if (!v) miss.push({ key, label }); };
  need(f.td.ten, 'td.ten', '1. Họ, chữ đệm và tên');
  need(f.td.ns, 'td.ns', '2. Ngày, tháng, năm sinh');
  need(f.td.gt, 'td.gt', '3. Giới tính');
  need(f.td.cc, 'td.cc', '4. Số định danh cá nhân');
  need(f.ch.ten, 'ch.ten', '7. Họ, chữ đệm và tên chủ hộ');
  need(f.td.qh, 'td.qh', '8. Mối quan hệ với chủ hộ');
  need(f.ch.cc, 'ch.cc', '9. Số định danh cá nhân của chủ hộ');
  need(f.nd, 'nd', '10. Nội dung đề nghị');
  f.tv.forEach((t, i) => {
    if (!Object.values(t).some(Boolean)) return; // dòng trống hoàn toàn: bỏ qua
    [['ten', 'họ tên'], ['ns', 'ngày sinh'], ['gt', 'giới tính'], ['cc', 'số định danh'], ['qh', 'quan hệ với chủ hộ']]
      .forEach(([k, l]) => need(t[k], `tv.${i}.${k}`, `Thành viên ${i + 1}: ${l}`));
  });
  return miss;
}
function markMissing(miss) {
  $$('#tab-form .missing').forEach(el => el.classList.remove('missing'));
  miss.forEach(m => $(`[data-k="${m.key}"]`)?.classList.add('missing'));
}
// Trả về true nếu được phép tiếp tục (đủ thông tin, hoặc người dùng đồng ý dù thiếu)
function confirmComplete(action) {
  const miss = missingFields(readForm());
  markMissing(miss);
  if (!miss.length) return true;
  const list = miss.slice(0, 15).map(m => '• ' + m.label).join('\n') + (miss.length > 15 ? `\n… và ${miss.length - 15} mục khác` : '');
  return confirm(`Phiếu còn thiếu ${miss.length} thông tin bắt buộc (đã tô đỏ):\n\n${list}\n\nVẫn tiếp tục ${action}?`);
}

/* ---------- Tự động lưu khi phiếu đã đủ thông tin ---------- */
let lastSavedJSON = null, autoTimer = null;
function scheduleAutosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    const f = readForm();
    if (missingFields(f).length || !validateAll()) return;
    if (JSON.stringify(f) === lastSavedJSON) return;
    if (await saveForm(true)) $('#form-status').textContent = `Đã tự động lưu lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}: ${f.td.ten}`;
  }, 1200);
}

/* ---------- Lưu ---------- */
async function savePeople(f) {
  const people = [{ ...f.td }, f.ch, ...f.tv].filter(p => /^\d{12}$/.test(p.cc || ''));
  for (const p of people) {
    const old = (await db.get('congdan', p.cc)) || {};
    const rec = { ...old, cc: p.cc, updatedAt: Date.now() };
    for (const k of ['ten', 'ns', 'gt', 'sdt']) if (p[k]) rec[k] = p[k];
    await db.put('congdan', rec);
  }
}
async function saveForm(silent = false) {
  if (!validateAll()) { if (!silent) toast('Có ô nhập sai định dạng (tô đỏ)'); return false; }
  const f = readForm();
  const now = Date.now();
  current = current ? { ...current, f, updatedAt: now } : { id: newId(), createdAt: now, updatedAt: now, f };
  await db.put('phieu', current);
  await savePeople(f);
  lastSavedJSON = JSON.stringify(f);
  $('#form-status').textContent = 'Đang sửa phiếu: ' + (f.td.ten || '(chưa có tên)');
  if (!silent) toast('Đã lưu phiếu');
  return true;
}

/* ---------- Xuất DOCX ---------- */
let templateBuf = null;
async function getTemplate() {
  if (!templateBuf) {
    const r = await fetch(TEMPLATE_URL);
    if (!r.ok) throw new Error('Không tải được mẫu ' + TEMPLATE_URL);
    templateBuf = await r.arrayBuffer();
  }
  return templateBuf;
}
function ngayNopText(iso) {
  if (!iso) return 'Ngày ....... tháng ....... năm ..........';
  const [y, m, d] = iso.split('-');
  return `Ngày ${d} tháng ${m} năm ${y}`;
}
function templateData(f) {
  const data = {
    'TÊN CƠ QUAN ĐĂNG KÝ CƯ TRÚ': f.coQuan,
    'TĐ TÊN': f.td.ten, 'TĐ NS': f.td.ns, 'TĐ GT': f.td.gt, 'TĐ SĐT': f.td.sdt, 'TĐ EMAIL': f.td.email,
    'TĐ QH': f.td.qh, 'CH TÊN': f.ch.ten, 'ND': f.nd, 'NGÀY NỘP': ngayNopText(f.ngayNop),
  };
  for (let i = 0; i < 12; i++) {
    const n = String(i + 1).padStart(2, '0');
    data[`TĐ CC ${n}`] = (f.td.cc || '')[i] || '';
    data[`CH CC ${n}`] = (f.ch.cc || '')[i] || '';
  }
  for (let i = 0; i < MAX_TV; i++) {
    const tv = f.tv[i] || {};
    data[`CĐ${i + 1} TÊN`] = tv.ten; data[`CĐ${i + 1} NS`] = tv.ns; data[`CĐ${i + 1} GT`] = tv.gt;
    data[`CĐ${i + 1} CC`] = tv.cc; data[`CĐ${i + 1} QH`] = tv.qh;
  }
  return data;
}
async function buildDocx(f) {
  const zip = new PizZip(await getTemplate());
  const doc = new window.docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true, linebreaks: true,
    nullGetter: () => '',
  });
  doc.render(templateData(f));
  return doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
const fileName = f => 'CT01_' + (f.td.ten || 'phieu').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');

/* ---------- Xem trước / In PDF ---------- */
async function renderDocx(blob, el) {
  el.innerHTML = '';
  await docx.renderAsync(blob, el, null, { inWrapper: false, ignoreLastRenderedPageBreak: true, breakPages: true });
  // docx-preview bỏ qua thụt lề bảng (tblInd) -> tự áp lại theo thứ tự bảng trong file
  const xml = new PizZip(await blob.arrayBuffer()).file('word/document.xml').asText();
  const inds = [...xml.matchAll(/<w:tbl>(.*?)<\/w:tblPr>/gs)].map(m => (m[1].match(/<w:tblInd w:w="(-?\d+)"/) || [])[1]);
  $$('table', el).forEach((t, i) => { if (inds[i]) t.style.marginLeft = inds[i] / 20 + 'pt'; });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  applyCellBorders(doc, el);
  shiftPlainTables(doc, el);
  const pairs = pairParagraphs(doc, el);
  fixEmptyParagraphs(pairs);
  applyLetterSpacing(pairs);
  fixVmlLines(el);
}
// Đoạn trống: Word cao theo cỡ chữ của dấu đoạn (mẫu dùng đoạn trống cỡ 1pt để chừa khoảng nhỏ),
// docx-preview lại cho cao 1 dòng chữ thường -> trang 1 bị dài hơn A4.
// Ghép từng đoạn HTML với đoạn tương ứng trong file Word (theo nội dung chữ; docx-preview tách đôi đoạn ở chỗ ngắt trang)
function pairParagraphs(doc, el) {
  const norm = s => s.replace(/\s/g, '');
  const xPs = [...doc.getElementsByTagName('w:p')];
  const hPs = $$('section.docx p', el);
  const xText = p => norm([...p.getElementsByTagName('w:t')].map(t => t.textContent).join(''));
  const pairs = [];
  let j = 0;
  for (const hp of hPs) {
    const ht = norm(hp.textContent);
    let k = j;
    while (k < xPs.length && xText(xPs[k]) !== ht) k++;
    if (k >= xPs.length) { pairs.push([hp, null]); continue; } // mảnh do tách trang
    pairs.push([hp, xPs[k]]); j = k + 1;
  }
  return pairs;
}
function fixEmptyParagraphs(pairs) {
  for (const [hp, xp] of pairs) {
    if (hp.textContent !== '' || hp.querySelector('svg, img, div')) continue;
    if (!xp) { hp.style.minHeight = '0'; continue; }
    const rPr = [...xp.children].find(n => n.tagName === 'w:pPr')?.getElementsByTagName('w:rPr')[0];
    const sz = +rPr?.getElementsByTagName('w:sz')[0]?.getAttribute('w:val') || 24; // mặc định 12pt
    hp.style.minHeight = (sz / 2 * 1.15).toFixed(2) + 'pt';
  }
}
// Giãn/co khoảng cách chữ (w:spacing trong rPr): docx-preview bỏ qua, Word dùng nhiều (-0,4pt) nên chữ trình duyệt dài hơn, dễ xuống dòng
function applyLetterSpacing(pairs) {
  for (const [hp, xp] of pairs) {
    if (!xp) continue;
    const spans = $$('span', hp).filter(s => !s.children.length && s.textContent);
    let si = 0;
    for (const r of xp.getElementsByTagName('w:r')) {
      const txt = [...r.getElementsByTagName('w:t')].map(t => t.textContent).join('');
      if (!txt) continue;
      while (si < spans.length && spans[si].textContent !== txt) si++;
      if (si >= spans.length) break;
      const rPr = [...r.children].find(n => n.tagName === 'w:rPr');
      const sp = [...(rPr?.children || [])].find(n => n.tagName === 'w:spacing')?.getAttribute('w:val');
      if (sp) spans[si].style.letterSpacing = (sp / 20) + 'pt';
      si++;
    }
  }
}
// Bảng không căn giữa và không có thụt lề: Word (chế độ tương thích của mẫu) đặt chữ ô đầu thẳng lề -> mép bảng lùi ra 5,4pt
function shiftPlainTables(doc, el) {
  const hTables = $$('table', el);
  [...doc.getElementsByTagName('w:tbl')].forEach((xt, i) => {
    const pr = [...xt.children].find(n => n.tagName === 'w:tblPr');
    if (!hTables[i]) return;
    // Bảng đặt độ rộng cột cố định (tblLayout fixed): giữ đúng độ rộng từng cột theo tblGrid
    if (pr?.getElementsByTagName('w:tblLayout')[0]?.getAttribute('w:type') === 'fixed') {
      const cols = [...xt.getElementsByTagName('w:gridCol')].map(c => +c.getAttribute('w:w') / 20);
      const t = hTables[i];
      t.style.tableLayout = 'fixed'; t.style.width = cols.reduce((a, b) => a + b, 0) + 'pt';
      t.querySelector('colgroup')?.remove();
      const cg = document.createElement('colgroup');
      cols.forEach(w => { const c = document.createElement('col'); c.style.width = w + 'pt'; cg.append(c); });
      t.prepend(cg);
    }
    if (pr?.getElementsByTagName('w:jc')[0] || pr?.getElementsByTagName('w:tblInd')[0]) return;
    hTables[i].style.marginLeft = '-5.4pt';
  });
}
// docx-preview bỏ qua viền riêng từng ô (tcBorders, ví dụ nét chấm giữa các dòng thành viên) -> áp lại
function applyCellBorders(doc, el) {
  const STYLE = { single: 'solid', dotted: 'dotted', dashed: 'dashed', double: 'double', nil: 'none', none: 'none' };
  const xTables = [...doc.getElementsByTagName('w:tbl')];
  const hTables = $$('table', el);
  xTables.forEach((xt, ti) => {
    const ht = hTables[ti]; if (!ht) return;
    const xRows = [...xt.children].filter(n => n.tagName === 'w:tr');
    if (xRows.length !== ht.rows.length) return;
    xRows.forEach((xr, ri) => {
      const xCells = [...xr.children].filter(n => n.tagName === 'w:tc');
      const hCells = ht.rows[ri].cells;
      if (xCells.length !== hCells.length) return;
      xCells.forEach((xc, ci) => {
        const b = xc.getElementsByTagName('w:tcBorders')[0]; if (!b) return;
        for (const side of ['top', 'left', 'bottom', 'right']) {
          const e = b.getElementsByTagName('w:' + side)[0]; if (!e) continue;
          const st = STYLE[e.getAttribute('w:val')] || 'solid';
          const w = Math.max(0.5, (+e.getAttribute('w:sz') || 4) / 8);
          hCells[ci].style['border' + side[0].toUpperCase() + side.slice(1)] = st === 'none' ? 'none' : `${w}pt ${st} #000`;
        }
      });
    });
  });
}
// Đường kẻ vẽ bằng VML (ví dụ gạch dưới "Độc lập – Tự do – Hạnh phúc"): docx-preview tạo svg rỗng -> thay bằng một đường kẻ
function fixVmlLines(el) {
  $$('svg', el).forEach(svg => {
    const st = svg.getAttribute('style') || '';
    if (svg.querySelector('g')?.childElementCount || !/height:\s*\.?0*\.?\d*pt/.test(st) || parseFloat(st.match(/height:\s*([\d.]+)pt/)?.[1]) > 1) return;
    const line = document.createElement('div');
    line.setAttribute('style', st);
    line.style.height = '0'; line.style.borderTop = '0.75pt solid #000';
    // VML neo theo đoạn chứa nó: lề trái tính từ cột chữ, lề trên tính từ đầu đoạn (kể cả khoảng cách trước đoạn)
    const p = svg.closest('p');
    if (p) {
      p.style.position = 'relative';
      line.style.left = '0';
      line.style.top = `calc(${parseFloat(st.match(/margin-top:\s*([-\d.]+)pt/)?.[1] || 0)}pt - ${getComputedStyle(p).marginTop})`;
      line.style.marginTop = '0';
    }
    svg.replaceWith(line);
  });
}
function fitPreview() {
  const area = $('#preview-area'), box = $('#preview-scroll');
  const sec = $('section.docx', area); if (!sec) return;
  area.style.zoom = 1;
  area.style.zoom = Math.min(1, (box.clientWidth - 20) / sec.offsetWidth);
}

/* ---------- Danh sách phiếu ---------- */
async function renderList() {
  const q = fold($('#list-search').value);
  const items = (await db.all('phieu')).sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(p => !q || fold([p.f.td.ten, p.f.td.cc, p.f.ch.ten, p.f.nd].join(' ')).includes(q));
  $('#list-items').innerHTML = items.map(p => `<div class="item">
      <b>${esc(p.f.td.ten || '(chưa có tên)')}</b>
      <div class="meta">${esc(p.f.td.cc || '')} · cập nhật ${new Date(p.updatedAt).toLocaleString('vi-VN')}<br>${esc((p.f.nd || '').slice(0, 120))}</div>
      <div class="btns">
        <button class="btn small" data-open="${p.id}">Mở</button>
        <button class="btn small" data-dup="${p.id}">Nhân bản</button>
        <button class="btn small danger" data-delp="${p.id}">Xoá</button>
      </div></div>`).join('') || '<p class="muted">Chưa có phiếu nào.</p>';
}

/* ---------- Danh bạ ---------- */
async function searchPeople(q, limit = 50) {
  q = fold(q);
  return (await db.all('congdan')).sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(p => !q || fold(p.ten + ' ' + p.cc).includes(q)).slice(0, limit);
}
const personLine = p => `<b>${esc(p.ten)}</b><div class="meta">${[p.cc, p.ns, p.gt, p.sdt].filter(Boolean).map(esc).join(' · ')}</div>`;
async function renderPeople() {
  const list = await searchPeople($('#people-search').value, 500);
  $('#people-items').innerHTML = list.map(p => `<div class="item">${personLine(p)}
      <div class="btns"><button class="btn small danger" data-delc="${p.cc}">Xoá</button></div></div>`).join('')
    || '<p class="muted">Danh bạ trống. Công dân được thêm tự động khi lưu phiếu có số định danh.</p>';
}

/* ---------- Hộp quét ---------- */
// Bộ quét tự viết thay cho html5-qrcode: lấy hình camera độ phân giải cao, cắt vùng giữa,
// giải mã bằng BarcodeDetector của trình duyệt nếu có, không có thì dùng ZXing (WASM).
// Mã QR trên thẻ CCCD nhỏ và dày, ở 640x480 mỗi ô chỉ ~1 điểm ảnh nên rất khó đọc.
const ZXING_WASM_DIR = 'https://cdn.jsdelivr.net/npm/zxing-wasm@1.3.4/dist/reader/';
const CAM_KEY = 'ct01-cam';
let scanTarget = null, stream = null, scanning = false, detector = null;
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { } };

async function getDetector() {
  if (detector) return detector;
  let BD = null;
  if ('BarcodeDetector' in window) {
    try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) BD = window.BarcodeDetector; } catch { }
  }
  if (!BD) {
    BarcodeDetectionAPI.setZXingModuleOverrides({ locateFile: (p, prefix) => p.endsWith('.wasm') ? ZXING_WASM_DIR + p : prefix + p });
    BD = BarcodeDetectionAPI.BarcodeDetector;
  }
  return detector = new BD({ formats: ['qr_code'] });
}
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1200; g.gain.value = 0.15;
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.15);
    o.onended = () => a.close();
  } catch { }
  navigator.vibrate?.(120);
}
function flash(els) {
  els.forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  const card = els[0]?.closest('.tv, .card');
  if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

const slotName = t => ({ td: 'Người kê khai', ch: 'Chủ hộ' }[t] || 'Thành viên ' + (+t.split('.')[1] + 1));
function openScan(target) {
  scanTarget = target;
  const auto = target === 'auto';
  $('#scan-title').textContent = auto ? 'Quét cả hộ' : 'Quét / tìm ' + slotName(target).toLowerCase();
  $('#auto-box').hidden = !auto;
  $('#auto-done').innerHTML = '';
  $('#scan-text').value = ''; $('#scan-search').value = ''; $('#scan-results').innerHTML = '';
  $('#scan-dlg').showModal();
  $('#scan-text').focus();
  startCam(); // mở camera ngay, không cần bấm thêm
}
// Đóng hộp quét chỉ tạm dừng camera; tắt hẳn sau 3 phút không dùng.
// Nhờ vậy quét nhiều người liên tiếp không phải mở lại camera (và không phải bấm cho phép trên điện thoại).
const CAM_IDLE_MS = 3 * 60 * 1000;
let idleTimer = null, loopId = 0, blockedQR = null;
function hideCamUI() {
  $('#cam-wrap').hidden = true; $('#cam-wrap').classList.remove('ok');
  $('#cam-select').hidden = true; $('#cam-zoom-wrap').hidden = true; $('#cam-tip').hidden = true;
  $('#scan-cam').hidden = false;
}
function pauseCam() {
  if ($('#scan-dlg').open) return; // hộp quét đã được mở lại trước khi sự kiện đóng tới
  scanning = false; hideCamUI();
  clearTimeout(idleTimer);
  if (stream) idleTimer = setTimeout(stopCam, CAM_IDLE_MS);
}
function stopCam() {
  scanning = false; clearTimeout(idleTimer);
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  $('#cam-video').srcObject = null;
  hideCamUI();
}
async function closeScan() { $('#scan-dlg').close(); } // sự kiện close sẽ gọi pauseCam
async function acceptQR(text) {
  const p = parseCCCD(text);
  if (!p) { toast('Không đọc được dữ liệu căn cước từ mã này'); return false; }
  const saved = (await db.get('congdan', p.cc)) || {};
  return fillPerson({ ...saved, ...p });
}
// Điền một người (từ QR hoặc danh bạ) vào ô đang quét, hoặc vào ô trống tiếp theo khi "Quét cả hộ".
async function fillPerson(person) {
  let target = scanTarget;
  if (target === 'auto') {
    const f = readForm();
    if ([f.td.cc, f.ch.cc, ...f.tv.map(t => t.cc)].includes(person.cc)) {
      toast(person.ten + ' đã có trong phiếu'); return false;
    }
    target = nextSlot();
    if (!target) { toast('Đã đủ ' + MAX_TV + ' thành viên'); return false; }
  }
  const els = setPerson(target, person);
  els.forEach(el => el.classList.remove('missing'));
  scheduleAutosave();
  beep();
  if (scanTarget !== 'auto') {
    await closeScan(); flash(els); toast('✓ Đã nhận: ' + person.ten, true);
    return true;
  }
  if (target === 'td' && $('#auto-self-ch').checked) selfChuHo();
  toast('✓ ' + slotName(target) + ': ' + person.ten, true);
  const li = document.createElement('li');
  li.className = 'new';
  li.textContent = `${slotName(target)}: ${person.ten}` + (target === 'td' && $('#auto-self-ch').checked ? ' (chủ hộ)' : '');
  $('#auto-done').append(li);
  $('#cam-wrap').classList.add('ok'); setTimeout(() => $('#cam-wrap').classList.remove('ok'), 800);
  $('#scan-text').value = ''; $('#scan-search').value = ''; $('#scan-results').innerHTML = '';
  $('#scan-text').focus();
  return true;
}
function nextSlot() {
  const f = readForm();
  const empty = p => !p.ten && !p.cc;
  if (empty(f.td)) return 'td';
  if (empty(f.ch) && !$('#auto-self-ch').checked) return 'ch';
  const i = f.tv.findIndex(empty);
  if (i >= 0) return 'tv.' + i;
  if (f.tv.length >= MAX_TV) return null;
  f.tv.push({}); renderTV(f.tv);
  return 'tv.' + (f.tv.length - 1);
}
function selfChuHo() {
  $('[data-k="ch.ten"]').value = $('[data-k="td.ten"]').value;
  $('[data-k="ch.cc"]').value = $('[data-k="td.cc"]').value;
  $('[data-k="td.qh"]').value = 'Chủ hộ';
  ['ch.ten', 'ch.cc', 'td.qh'].forEach(k => $(`[data-k="${k}"]`).classList.remove('missing'));
  validateAll();
  scheduleAutosave();
}
async function startCam(deviceId) {
  clearTimeout(idleTimer);
  $('#scan-cam').hidden = true;
  const v = $('#cam-video');
  if (stream?.active && !deviceId) {
    await v.play().catch(() => { }); // camera còn mở từ lần trước -> dùng tiếp
  } else {
    stopCam(); $('#scan-cam').hidden = true;
    const want = deviceId || lsGet(CAM_KEY);
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (want) video.deviceId = { exact: want }; else video.facingMode = 'environment';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video });
    } catch (e) {
      if (want && !deviceId) { lsSet(CAM_KEY, ''); return startCam(); } // camera đã lưu không còn -> dùng mặc định
      $('#scan-cam').hidden = false;
      toast('Không mở được camera: ' + (e.message || e)); return;
    }
    if (!$('#scan-dlg').open) { pauseCam(); return; } // hộp quét đã đóng trong lúc chờ camera
    v.srcObject = stream; await v.play();
    const t = stream.getVideoTracks()[0], c = t.getCapabilities?.() || {};
    try { if (c.focusMode?.includes('continuous')) await t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { }
  }
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  if (caps.zoom) {
    const z = $('#cam-zoom');
    z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1;
    z.value = track.getSettings().zoom || caps.zoom.min;
    $('#cam-zoom-wrap').hidden = false;
  }
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  const sel = $('#cam-select');
  sel.innerHTML = cams.map((c, i) => `<option value="${esc(c.deviceId)}">${esc(c.label || 'Camera ' + (i + 1))}</option>`).join('');
  sel.value = track.getSettings().deviceId || '';
  sel.hidden = cams.length < 2;
  $('#scan-cam').hidden = true; $('#cam-wrap').hidden = false; $('#cam-tip').hidden = false;
  $('#cam-info').textContent = `${v.videoWidth}×${v.videoHeight}`;
  scanning = true;
  scanLoop();
}
// Quét mã QR từ ảnh (chọn file hoặc dán Ctrl+V). Ảnh có nhiều thẻ: "Quét cả hộ" điền hết, theo thứ tự trên→dưới, trái→phải.
async function scanImage(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { toast('Không mở được ảnh này'); return; }
  let det;
  try { det = await getDetector(); } catch (e) { toast('Không tải được bộ đọc QR: ' + e.message); return; }
  const sources = [bmp];
  const k = 1600 / Math.max(bmp.width, bmp.height);
  if (k < 1) { // ảnh điện thoại rất lớn: thử thêm bản thu nhỏ
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    sources.push(c);
  }
  let found = [];
  for (const src of sources) {
    try { found = (await det.detect(src)).filter(c => parseCCCD(c.rawValue)); } catch (e) { console.warn(e); }
    if (found.length) break;
  }
  if (!found.length) { toast('Không tìm thấy mã QR căn cước trong ảnh'); return; }
  found.sort((a, b) => (a.boundingBox.y - b.boundingBox.y) || (a.boundingBox.x - b.boundingBox.x));
  const raws = [...new Set(found.map(c => c.rawValue))];
  if (scanTarget !== 'auto') { await acceptQR(raws[0]); return; }
  for (const r of raws) await acceptQR(r);
}

const scanCanvas = document.createElement('canvas');
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
async function scanLoop() {
  const v = $('#cam-video');
  let det;
  try { det = await getDetector(); } catch (e) { toast('Không tải được bộ đọc QR: ' + e.message); return; }
  let crop = false, lastWrong = 0, lastHint = 0, goneFrames = 0;
  const id = ++loopId; // chỉ một vòng quét chạy tại một thời điểm
  while (scanning && id === loopId) {
    // Thẻ vừa quét xong (hoặc khung hình cũ còn sót lại) bị bỏ qua cho tới khi thẻ rời khỏi khung ~8 lượt liên tiếp
    if (blockedQR && goneFrames >= 8) blockedQR = null;
    if (v.readyState >= 2 && v.videoWidth) {
      // Lần lượt: vùng giữa (60% cạnh ngắn, đúng khung hướng dẫn) và cả khung hình
      const W = v.videoWidth, H = v.videoHeight;
      let sx = 0, sy = 0, sw = W, sh = H;
      crop = !crop;
      if (crop) { const s = Math.round(Math.min(W, H) * 0.6); sx = (W - s) >> 1; sy = (H - s) >> 1; sw = sh = s; }
      scanCanvas.width = sw; scanCanvas.height = sh;
      scanCtx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
      try {
        const codes = await det.detect(scanCanvas);
        goneFrames = codes.some(c => c.rawValue === blockedQR) ? 0 : goneFrames + 1;
        const hit = codes.find(c => parseCCCD(c.rawValue) && c.rawValue !== blockedQR);
        if (hit && scanning) {
          blockedQR = hit.rawValue; goneFrames = 0; lastHint = Date.now(); // chưa nhắc ngay sau khi vừa nhận
          await acceptQR(hit.rawValue);
          if (scanTarget !== 'auto') return; // quét cả hộ: tiếp tục chờ thẻ tiếp theo
        }
        if (blockedQR && goneFrames === 0 && Date.now() - lastHint > 3000) {
          lastHint = Date.now(); toast('Thẻ này vừa quét xong. Đưa thẻ tiếp theo vào (cùng người thì nhấc thẻ ra rồi đưa lại)');
        }
        if (codes.length && !codes.some(c => parseCCCD(c.rawValue)) && Date.now() - lastWrong > 3000) { lastWrong = Date.now(); toast('Đã thấy mã QR nhưng không phải mã căn cước'); }
      } catch (e) { console.warn(e); }
    }
    await new Promise(r => setTimeout(r, 30));
  }
}

/* ---------- Tabs ---------- */
function showTab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  if (name === 'list') renderList();
  if (name === 'people') renderPeople();
  if (name === 'settings') loadSettings();
}
async function loadSettings() {
  $('#set-coquan').value = (await db.get('settings', 'coQuan')) || '';
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $('#storage-info').textContent = `Đang dùng ${(e.usage / 1024).toFixed(0)} KB. ${persisted ? 'Trình duyệt đã cho phép lưu lâu dài.' : 'Trình duyệt chưa cam kết lưu lâu dài — nhớ sao lưu.'}`;
  }
}

/* ---------- Gắn sự kiện ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.tab) showTab(d.tab);
  else if (d.scan) openScan(d.scan);
  else if (d.delTv !== undefined) { const f = readForm(); f.tv.splice(+d.delTv, 1); renderTV(f.tv); scheduleAutosave(); }
  else if (d.open) openForm(await db.get('phieu', d.open));
  else if (d.dup) {
    const p = await db.get('phieu', d.dup);
    openForm({ ...p, id: undefined }); current = null;
    $('#form-status').textContent = 'Phiếu mới (nhân bản từ ' + (p.f.td.ten || 'phiếu cũ') + ')';
    $('[data-k="ngayNop"]').value = todayISO();
  }
  else if (d.delp) { if (confirm('Xoá phiếu này? Không thể khôi phục.')) { await db.del('phieu', d.delp); if (current?.id === d.delp) newForm(); renderList(); } }
  else if (d.delc) { if (confirm('Xoá công dân này khỏi danh bạ?')) { await db.del('congdan', d.delc); renderPeople(); } }
  else if (d.pick) fillPerson(await db.get('congdan', d.pick));
});

$('#btn-new').onclick = () => newForm();
$('#btn-add-tv').onclick = () => { const f = readForm(); if (f.tv.length < MAX_TV) { f.tv.push({}); renderTV(f.tv); $(`[data-k="tv.${f.tv.length - 1}.ten"]`).focus(); } };
$('#btn-self-ch').onclick = selfChuHo;
$('#auto-self-ch').onchange = e => {
  const f = readForm();
  if (e.target.checked && (f.td.ten || f.td.cc) && !f.ch.ten && !f.ch.cc) selfChuHo();
};
$('#auto-finish').onclick = () => {
  const n = $('#auto-done').children.length;
  closeScan();
  const filled = $$('#tab-form [data-k^="td."], #tab-form [data-k^="ch."], #tab-form [data-k^="tv."]').filter(el => el.value && !el.matches('[data-k$=".qh"]'));
  if (n) { flash(filled); toast(`✓ Đã nhận ${n} người`, true); }
};
$('#btn-save').onclick = () => { if (confirmComplete('lưu')) saveForm(); };
$('#btn-docx').onclick = async () => {
  if (!confirmComplete('xuất DOCX')) return;
  try { const f = readForm(); download(await buildDocx(f), fileName(f) + '.docx'); }
  catch (e) { console.error(e); toast('Lỗi tạo DOCX: ' + e.message); }
};
$('#btn-preview').onclick = async () => {
  if (!confirmComplete('xem / in PDF')) return;
  try {
    const blob = await buildDocx(readForm());
    $('#preview-dlg').showModal();
    await renderDocx(blob, $('#preview-area'));
    fitPreview();
  } catch (e) { console.error(e); toast('Lỗi xem trước: ' + e.message); }
};
$('#btn-print').onclick = async () => {
  const f = readForm();
  const old = document.title; document.title = fileName(f); // tên gợi ý khi lưu PDF
  await renderDocx(await buildDocx(f), $('#print-area'));
  window.print();
  document.title = old;
};
$('#preview-close').onclick = () => $('#preview-dlg').close();
window.addEventListener('resize', () => { if ($('#preview-dlg').open) fitPreview(); });

$('#tab-form').addEventListener('input', e => {
  const el = e.target;
  if (el.classList.contains('cc')) {
    el.value = el.value.replace(/\D/g, '').slice(0, 12);
    const gt = $(`[data-k="${el.dataset.k.replace(/cc$/, 'gt')}"]`); // người kê khai, thành viên (chủ hộ không có ô giới tính)
    if (gt && genderFromCC(el.value)) { gt.value = genderFromCC(el.value); gt.classList.remove('missing'); }
  }
  if (el.classList.contains('date')) el.value = fmtDateInput(el.value);
  if (el.classList.contains('invalid')) validate(el);
  if (el.value) el.classList.remove('missing');
  scheduleAutosave();
});
$('#tab-form').addEventListener('change', scheduleAutosave);
$('#tab-form').addEventListener('focusout', e => { if (e.target.matches('input.cc, input.date')) validate(e.target); });

$('#scan-close').onclick = () => closeScan();
$('#scan-dlg').addEventListener('close', pauseCam);
$('#scan-cam').onclick = () => startCam();
$('#scan-img').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) scanImage(f); };
// Dán ảnh (ảnh chụp màn hình, ảnh copy từ trình duyệt, hoặc file ảnh copy từ thư mục) hay kéo-thả ảnh vào hộp quét
const imageFile = dt => [...(dt?.files || [])].find(f => f.type.startsWith('image/'))
  || [...(dt?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
document.addEventListener('paste', e => {
  if (!$('#scan-dlg').open) return;
  const f = imageFile(e.clipboardData);
  if (f) { e.preventDefault(); scanImage(f); }
});
// Thả ảnh ra ngoài hộp quét: chặn trình duyệt mở ảnh thay cho app (mất phiếu đang nhập)
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
const dlg = $('#scan-dlg');
dlg.addEventListener('dragover', e => { e.preventDefault(); dlg.classList.add('dragging'); });
dlg.addEventListener('dragleave', e => { if (!dlg.contains(e.relatedTarget)) dlg.classList.remove('dragging'); });
dlg.addEventListener('drop', e => {
  e.preventDefault(); dlg.classList.remove('dragging');
  const f = imageFile(e.dataTransfer);
  if (f) scanImage(f); else toast('Chỉ nhận file ảnh. Ảnh kéo từ trang web khác: hãy chuột phải → Sao chép hình ảnh rồi Ctrl+V');
});
$('#cam-select').onchange = e => { lsSet(CAM_KEY, e.target.value); startCam(e.target.value); };
$('#cam-zoom').oninput = e => stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: +e.target.value }] }).catch(() => { });
$('#scan-text').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); acceptQR(e.target.value); } });
$('#scan-search').addEventListener('input', async e => {
  const list = e.target.value.trim() ? await searchPeople(e.target.value, 20) : [];
  $('#scan-results').innerHTML = list.map(p => `<div class="item"><button class="btn ghost" style="width:100%;justify-content:flex-start;text-align:left;display:block" data-pick="${p.cc}">${personLine(p)}</button></div>`).join('')
    || (e.target.value.trim() ? '<p class="muted">Không tìm thấy.</p>' : '');
});

$('#list-search').addEventListener('input', renderList);
$('#people-search').addEventListener('input', renderPeople);

$('#btn-save-settings').onclick = async () => { await db.put('settings', norm($('#set-coquan').value), 'coQuan'); toast('Đã lưu cài đặt'); };
$('#btn-export').onclick = async () => {
  const data = { app: 'ct01', version: 1, exportedAt: new Date().toISOString(),
    phieu: await db.all('phieu'), congdan: await db.all('congdan'), coQuan: await db.get('settings', 'coQuan') };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `saoluu_CT01_${todayISO()}.json`);
};
$('#file-import').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'ct01') throw new Error('Không phải file sao lưu CT01');
    if (!confirm(`Nhập ${data.phieu.length} phiếu và ${data.congdan.length} công dân? Phiếu trùng sẽ được ghi đè.`)) return;
    for (const p of data.phieu) await db.put('phieu', p);
    for (const c of data.congdan) await db.put('congdan', c);
    if (data.coQuan) await db.put('settings', data.coQuan, 'coQuan');
    toast('Đã nhập dữ liệu'); loadSettings();
  } catch (err) { toast('Lỗi nhập: ' + err.message); }
};

/* ---------- Khởi động ---------- */
newForm();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

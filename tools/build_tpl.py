import sys, zipfile, re
src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)
x = zin.read('word/document.xml').decode('utf8')
# 3. đổi tên placeholder
x = x.replace('{{Nam/Nữ}}', '{{TĐ GT}}').replace('{{TĐ QH CH}}', '{{TĐ QH}}')
tbls = list(re.finditer(r'<w:tbl>.*?</w:tbl>', x, re.S))
t = tbls[2]; tb = t.group(0)
rows = re.findall(r'<w:tr[ >].*?</w:tr>', tb, re.S)
assert '{{CĐ9 TÊN}}' in rows[9]
# 1. thêm dòng 10
r10 = re.sub(r' w14:(paraId|textId)="[^"]*"', '', rows[9].replace('CĐ9', 'CĐ10'))
rows.append(r10)
# 2. TT cố định
def add_tt(row, n):
    i = row.index('</w:tc>')
    cell = row[:i]
    assert '<w:t>' not in cell and cell.endswith('</w:p>')
    cell = cell.replace('</w:pPr></w:p>', '</w:pPr><w:r><w:rPr><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t>%d</w:t></w:r></w:p>' % n)
    cell = cell.replace('<w:rPr><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang', '<w:jc w:val="center"/><w:rPr><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang', 1)
    return cell + row[i:]
new_rows = [rows[0]] + [add_tt(r, n) for n, r in enumerate(rows[1:], 1)]
old = re.findall(r'<w:tr[ >].*?</w:tr>', tb, re.S)
new_tb = tb[:tb.index(old[0])] + ''.join(new_rows) + tb[tb.index(old[-1]) + len(old[-1]):]
x = x[:t.start()] + new_tb + x[t.end():]
# 4. bảng ô số định danh: cột đầu trong tblGrid nhỏ hơn tcW -> trình duyệt bị xuống dòng. Đồng bộ theo tcW.
# Lấy đúng kích thước cột của bản CT01 đã điền tay: cả hai bảng sát lề trái, không căn giữa.
ID_WIDTHS = {
    '{{TĐ CC 01}}': [3652, 442, 442] + [441] * 10,
    '{{CH CC 01}}': [4141] + [412] * 4 + [411] * 8,
}
def fix_grid(m):
    tb = m.group(0)
    key = next((k for k in ID_WIDTHS if k in tb), None)
    if not key: return tb
    ws = iter(ID_WIDTHS[key])
    tb = re.sub(r'<w:gridCol w:w="\d+"/>', lambda _: '<w:gridCol w:w="%d"/>' % next(ws), tb)
    ws = iter(ID_WIDTHS[key])
    tb = re.sub(r'<w:tcW w:w="\d+" w:type="dxa"/>', lambda _: '<w:tcW w:w="%d" w:type="dxa"/>' % next(ws), tb)
    tblpr = re.search(r'<w:tblPr>.*?</w:tblPr>', tb, re.S).group(0)
    tb = re.sub(r'(<w:trPr>.*?)<w:jc w:val="center"/>(.*?</w:trPr>)', r'\1\2', tb, flags=re.S)  # bỏ căn giữa theo dòng
    # chữ số trong các ô: cỡ 10 -> 13 cho bằng chữ bên ngoài
    tb = re.sub(r'<w:tc>.*?</w:tc>', lambda c: re.sub(r'<w:(sz|szCs) w:val="20"/>', r'<w:\1 w:val="26"/>', c.group(0)) if '{{' in c.group(0) else c.group(0), tb, flags=re.S)
    new_pr = re.sub(r'<w:jc w:val="[^"]*"/>', '', tblpr)
    new_pr = re.sub(r'<w:tblW w:w="\d+"', '<w:tblW w:w="%d"' % sum(ID_WIDTHS[key]), new_pr)
    return tb.replace(tblpr, new_pr, 1)
x = re.sub(r'<w:tbl>.*?</w:tbl>', fix_grid, x, flags=re.S)
# Bảng thành viên: cột "Mối quan hệ" 21,1% -> 16,6%; các cột khác giữ độ rộng thật, cả bảng hẹp lại.
MEM_PCT = [227, 1878, 754, 497, 814, 830]      # phần 5000 của bảng (830 = 16,6%)
MEM_TWIPS = [439, 3632, 1458, 961, 1574, 1605]  # tblGrid tương ứng
def fix_members(m):
    tb = m.group(0)
    if '{{CĐ1 TÊN}}' not in tb: return tb
    tb = re.sub(r'<w:tblW w:w="\d+" w:type="pct"/>', '<w:tblW w:w="5330" w:type="pct"/>', tb, 1)
    g = iter(MEM_TWIPS)
    tb = re.sub(r'<w:gridCol w:w="\d+"/>', lambda _: '<w:gridCol w:w="%d"/>' % next(g), tb)
    def row(r):
        w = iter(MEM_PCT)
        return re.sub(r'<w:tcW w:w="\d+" w:type="pct"/>', lambda _: '<w:tcW w:w="%d" w:type="pct"/>' % next(w), r.group(0))
    return re.sub(r'<w:tr[ >].*?</w:tr>', row, tb, flags=re.S)
x = re.sub(r'<w:tbl>.*?</w:tbl>', fix_members, x, flags=re.S)
# 5. bỏ các đoạn trống sau chú thích (7) gây ra trang trắng cuối
i = x.index('(7) Ch'); j = x.index('</w:p>', i) + len('</w:p>'); k = x.index('<w:sectPr', j)
tail = re.sub(r'<w:p [^>]*>(?:(?!<w:t[ >]).)*?</w:p>', '', x[j:k], flags=re.S)
x = x[:j] + tail + x[k:]
zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    zout.writestr(it, x.encode('utf8') if it.filename == 'word/document.xml' else zin.read(it.filename))
zout.close()
print('ok')

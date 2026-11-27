# App điền mẫu CT01 (phương án A, chạy offline)

Toàn bộ việc điền mẫu, xuất DOCX/PDF và lưu phiếu đều diễn ra trong trình duyệt của từng thiết bị.
Dữ liệu công dân được lưu trong trình duyệt (IndexedDB) và không gửi đi đâu.

## Mở app bằng biểu tượng

Bấm đúp vào lối tắt **Tờ khai CT01** trong thư mục `CT01 App`. Lối tắt này chạy `tools/mo_app.pyw`:
- bật máy chủ nội bộ nếu máy chủ chưa chạy (không hiện cửa sổ đen);
- mở app trong một cửa sổ riêng, không có thanh địa chỉ (dùng Chrome, nếu không có thì dùng Edge).

Nếu cần tạo lại lối tắt thì làm như sau:
- Đích (target): `pythonw.exe "D:\Project\WEB APP HC\CT01 App\tools\mo_app.pyw"`
- Biểu tượng: `icon.ico`

## Chạy thử trên máy tính

```
python -m http.server 8765 --bind 127.0.0.1 --directory "CT01 App"
```
Sau đó mở http://127.0.0.1:8765

Lưu ý: không mở trực tiếp file `index.html` bằng cách nhấp đúp, vì trình duyệt sẽ chặn việc đọc file mẫu và chặn camera.

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `style.css`, `app.js` | Giao diện và xử lý |
| `templates/CT01.docx` | Mẫu Word có các ô `{{...}}` |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Cho phép cài như ứng dụng và chạy không cần mạng |
| `tools/build_tpl.py` | Tạo lại `templates/CT01.docx` từ file `CT01/CT01_Placeholder CLAUDE.docx` |

## Sửa mẫu Word

1. Sửa file `CT01/CT01_Placeholder CLAUDE.docx`.
2. Chạy lệnh sau để tạo lại mẫu cho app (script sẽ thêm dòng 10, ghi số TT và dọn trang trắng):
   ```
   python "CT01 App/tools/build_tpl.py" "CT01/CT01_Placeholder CLAUDE.docx" "CT01 App/templates/CT01.docx"
   ```
3. Tăng `CACHE` trong `sw.js` (ví dụ `ct01-v2`) để các máy đã cài app nhận bản mới.

## Dữ liệu

- Mỗi thiết bị lưu dữ liệu riêng.
- Vào **Cài đặt → Xuất file sao lưu** để sao lưu, và dùng **Nhập file sao lưu** để chuyển dữ liệu sang máy khác.
- Nếu xoá dữ liệu trình duyệt hoặc gỡ app thì sẽ mất phiếu, vì vậy cần sao lưu định kỳ.

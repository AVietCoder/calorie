# reference-menus/

Đặt các file thực đơn Excel mẫu (.xlsx / .xlsm) vào thư mục này, rồi chạy:

```bash
pip install -r scripts/requirements.txt
npm run build:excel-templates
```

Script `scripts/extract-excel-templates.py` sẽ quét toàn bộ corpus và sinh ra:

- `knowledge/excel-theme.json` — bộ design token (màu, font, kích thước) mà
  `lib/excel/theme.js` nạp lúc chạy
- `knowledge/excel-template-profiles.json` — fingerprint đầy đủ từng file
  (ngữ pháp bố cục, style theo vai trò, bề rộng cột, page setup)

Nhờ vậy bộ nhận diện của file xuất ra **được suy từ dữ liệu**, không hard-code
theo một file mẫu nào. Thêm mẫu mới → chạy lại script → theme tự cập nhật.

Thư mục này KHÔNG được commit file mẫu lên git (xem .gitignore) vì đó là tài
liệu của bên thứ ba.

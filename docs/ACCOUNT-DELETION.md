# Xoá tài khoản (Account Deletion)

Tính năng bắt buộc theo chính sách **Delete Account** của Google Play: người dùng
phải xoá được tài khoản ngay trong ứng dụng, và phải có một trang web công khai
mô tả quy trình.

---

## 1. Bề mặt tính năng

| Nơi | Đường dẫn | Ghi chú |
|---|---|---|
| Web | `/settings` → Vùng nguy hiểm → Xoá tài khoản | cần đăng nhập |
| Mobile | Hồ sơ → nút bánh răng → Cài đặt → Xoá tài khoản | cần đăng nhập |
| Trang công khai | `/delete-account` | **không** cần đăng nhập — URL nộp cho Google Play |
| API | `DELETE /api/account` | lấy id từ token, không nhận tham số |

Đường dẫn trong ứng dụng (Hồ sơ → Cài đặt → Xoá tài khoản) được mô tả nguyên văn
ở `/delete-account`. **Đổi vị trí nút thì phải sửa trang đó cùng lúc**, lệch một
bước là hồ sơ Google Play bị từ chối.

---

## 2. Cài đặt

Chạy `migrations/account_deletion.sql` trong Supabase SQL Editor. Migration này
additive và idempotent — tạo:

* bảng `account_deletion_log` (nhật ký, **không** có khoá ngoại tới `auth.users`
  vì phải sống lâu hơn người dùng);
* hàm `public.delete_user_account(uuid)`.

Kiểm tra sau khi chạy:

```bash
npm run verify:account-deletion
```

Script chỉ đọc, không xoá gì. Nó soát **mọi bảng** trong `migrations/` và trong
mã nguồn, tìm bảng có cột trỏ tới người dùng (`user_id`, `owner_id`,
`created_by`, `uploaded_by`, `updated_by`, `decided_by`, `email`,
`uploaded_by_email`), rồi báo lỗi nếu bảng đó không được xử lý trong migration.

> **Thêm bảng mới có cột người dùng thì phải cập nhật `account_deletion.sql`.**
> Script trên chính là thứ sẽ chặn việc quên — hãy chạy nó trong CI nếu có.

Biến môi trường bắt buộc: `SUPABASE_SERVICE_ROLE_KEY` (để gọi Admin API xoá dòng
`auth.users`). Thiếu key thì API trả **503** và *không đụng vào dữ liệu* — thà
không làm gì còn hơn xoá nửa vời.

---

## 3. Luồng phía máy chủ

`lib/account-deletion.js` — thứ tự có chủ đích, không đảo được:

1. **Kiểm tra service role.** Thiếu thì dừng ngay, chưa xoá gì.
2. **Đọc `cloudinary_public_id`** của ảnh món ăn — phải lấy trước, xoá dòng DB
   rồi là mất đường tra file.
3. **Gọi `delete_user_account(uuid)`** — toàn bộ dữ liệu ứng dụng trong **một
   transaction**. supabase-js gửi mỗi lệnh là một request riêng nên không thể
   gói transaction từ Node; đó là lý do phần này nằm trong hàm plpgsql.
4. **Xoá file trên Cloudinary** (best-effort, ngoài transaction — hệ thống khác,
   và rollback cũng không lấy lại được file đã xoá).
5. **Xoá dòng `auth.users`** bằng Admin API.

Bước 3 trước bước 5 là cố ý: nếu bước 5 hỏng, người dùng vẫn đăng nhập được vào
một tài khoản rỗng và bấm xoá lại. Làm ngược lại thì họ mất quyền đăng nhập
trong khi dữ liệu cá nhân vẫn còn và không ai xoá hộ được.

---

## 4. Dữ liệu bị tác động

**Xoá hẳn:** `profiles` (kèm `chat_history`, `weekly_plan`), `chat_images` +
file trên Cloudinary, `ai_usage_logs`, `menu_import_logs`, `survey_responses`
(+ `survey_answers` theo cascade), `household_members`,
`household_join_requests`, `household_notifications` gửi cho người này,
`household_invites` khớp email, gia đình do người này làm chủ (kéo theo
`weekly_menu_plans` → `plan_days` → `plan_meals` → `plan_dishes` →
`plan_dish_ingredients`, `shopping_lists` → `shopping_list_items`,
`menu_adjustment_audit`), và thực đơn **riêng tư** của hộ đó.

**Giữ lại nhưng gỡ danh tính:** `menu_templates.created_by`,
`admin_pdfs.uploaded_by`, `ingredient_prices.updated_by`,
`household_join_requests.decided_by` → `null`.

Lý do: đây là nội dung **dùng chung**, người khác đang dùng. Xoá chúng là lấy đi
dữ liệu của người khác; ẩn danh là đủ để không còn dấu vết cá nhân.

**Giữ lại:** một dòng trong `account_deletion_log` gồm `user_id`, thời điểm và
thống kê số bản ghi đã xoá. Không lưu email hay tên — mục đích là chứng minh "đã
xử lý yêu cầu xoá lúc nào", giữ thêm là đi ngược chính chính sách này.

### Chủ hộ xoá tài khoản

Gia đình bị giải tán. Thành viên khác thường không online lúc đó, nên hàm ghi
sẵn thông báo `removed_from_family` cho từng người — đúng cơ chế đang dùng khi
chủ hộ xoá thành viên. Thông báo sống sót vì `household_notifications.household_id`
khai `on delete set null` chứ không cascade.

Thực đơn **riêng tư** của hộ bị xoá hẳn: `menu_templates.owner_household_id`
khai `on delete set null`, để cascade tự chạy sẽ tạo ra dòng vừa `private` vừa
không thuộc hộ nào — vô hình với mọi người mãi mãi.

---

## 5. Bảo mật

* Id người bị xoá **luôn** lấy từ token, route không nhận tham số nào ⇒ không có
  đường nào gửi id của người khác vào.
* `delete_user_account` bị `revoke` khỏi `anon`/`authenticated`; chỉ service role
  gọi được. Mở cho `authenticated` sẽ cho phép bất kỳ ai truyền uuid người khác.
* Không cần chống CSRF riêng: xác thực bằng Bearer token đọc từ
  localStorage/AsyncStorage, không phải cookie, nên trình duyệt không tự đính kèm
  thông tin đăng nhập vào request từ site khác.
* Chống bấm hai lần: khoá theo `userId` trong tiến trình + nút bị disable khi
  đang gửi + hàm SQL idempotent (gọi lại với user đã xoá trả về thống kê rỗng,
  không lỗi).
* `Access-Control-Allow-Methods` phải có `DELETE` (`lib/cors.js`) — thiếu thì
  preflight từ app mobile bị chặn.

---

## 6. Sau khi xoá, phía client

**Web** (`components/DeleteAccountDialog.jsx`): xoá các khoá localStorage theo
tiền tố `calorie_ai_`, `dr-fit:`, `user_id`, `chat_history`, `plan_cache`; xoá
sessionStorage; hiện màn thành công ~2,6 giây rồi `logout()` đẩy về `/signin`.

**Mobile** (`src/screens/SettingsScreen.js`): `clearAuth()` + `clearLocalUserData()`
(gỡ `calorie_ai_intake_*`, `calorie_ai_reminders_*`), hiện màn thành công, người
dùng bấm nút mới thoát về luồng đăng nhập.

Cả hai **cố ý giữ** tuỳ chọn ngôn ngữ (`calorie_ai_lang`) và thiết lập giao diện:
đó là thiết lập của thiết bị, không phải dữ liệu cá nhân — xoá đi chỉ khiến máy
đột ngột đổi về tiếng mặc định mà chẳng bảo vệ được gì.

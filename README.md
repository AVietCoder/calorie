# Calorie AI

## Tổng quan
Calorie AI là nền tảng hỗ trợ cá nhân hóa dinh dưỡng bằng AI, giúp người dùng theo dõi lượng calorie, xây dựng thực đơn và điều chỉnh kế hoạch ăn uống theo mục tiêu sức khỏe. Ứng dụng hướng đến trải nghiệm thực tế, nơi người dùng có thể nhập thông tin cơ thể, nhận chỉ số dinh dưỡng nền tảng, trò chuyện với AI Coach và cập nhật bữa ăn hằng ngày bằng mô tả hoặc hình ảnh.

Điểm khác biệt của Calorie AI là kết hợp giữa tư vấn dinh dưỡng cá nhân hóa, phân tích món ăn bằng AI và khả năng tự động điều chỉnh thực đơn theo hành vi ăn uống thực tế của người dùng.

## Tính năng nổi bật
- Cá nhân hóa hồ sơ sức khỏe dựa trên giới tính, năm sinh, chiều cao, cân nặng, cân nặng mục tiêu, mức độ vận động, deadline và sở thích ăn uống.
- Tự động tính BMR, TDEE, calories mục tiêu mỗi ngày và phân bổ macro gồm protein, fat, carbs.
- Sinh thực đơn 7 ngày phù hợp với mục tiêu như giảm cân, tăng cân, giữ cân hoặc tăng cơ.
- Hỗ trợ AI Coach để người dùng hỏi đáp về dinh dưỡng, món ăn, khẩu phần và cách điều chỉnh bữa ăn.
- Phân tích món ăn từ ảnh hoặc mô tả văn bản để ước lượng calories và các thành phần dinh dưỡng.
- Cho phép xác nhận bữa ăn theo thời điểm thực tế trong ngày, từ đó cập nhật lại thực đơn tuần một cách linh hoạt.
- Lưu lịch sử tương tác để AI có thể phản hồi theo ngữ cảnh cá nhân thay vì trả lời rời rạc.
- Hiển thị tiến trình trực quan bằng dashboard với các chỉ số calories, BMR, TDEE, macro và tiến độ cân nặng.
- Hỗ trợ tái thiết lập chặng mới khi người dùng đã hoàn thành deadline mục tiêu cũ.

## User Flow
1. Người dùng truy cập hệ thống và tạo tài khoản hoặc đăng nhập.
2. Người dùng hoàn thiện hồ sơ cá nhân với các thông tin cơ bản về cơ thể, mục tiêu và thói quen ăn uống.
3. Hệ thống tính toán mức năng lượng nền, nhu cầu calories mỗi ngày và tỷ lệ macro phù hợp.
4. AI tạo thực đơn 7 ngày đầu tiên dựa trên dữ liệu hồ sơ và mục tiêu sức khỏe.
5. Người dùng theo dõi các chỉ số dinh dưỡng qua dashboard và lịch thực đơn tuần.
6. Trong quá trình sử dụng, người dùng có thể gửi ảnh món ăn hoặc mô tả bữa ăn để AI phân tích.
7. Sau khi nhận diện món ăn, hệ thống ghi nhận bữa ăn theo đúng thời điểm và điều chỉnh thực đơn khi cần.
8. Khi đạt hoặc vượt qua deadline đặt ra, hệ thống hướng dẫn người dùng cập nhật chỉ số mới để bắt đầu chu kỳ tiếp theo.

## Giá trị sản phẩm
- Giúp người dùng hiểu rõ nhu cầu năng lượng của bản thân thay vì ăn theo cảm tính.
- Biến kế hoạch ăn uống thành một quy trình có thể theo dõi, cập nhật và tối ưu liên tục.
- Tạo trải nghiệm gần với một “AI Nutrition Coach” thay vì chỉ là công cụ tính calories đơn thuần.
- Phù hợp với bối cảnh món ăn quen thuộc của người Việt, giúp gợi ý thực tế và dễ áp dụng hơn.

## Công nghệ áp dụng

### Frontend
- HTML, CSS, JavaScript thuần.
- Giao diện responsive, kết hợp biểu đồ trực quan để hiển thị các chỉ số dinh dưỡng và tiến độ.
- Tăng trải nghiệm người dùng bằng toast notification, biểu đồ động và giao diện chat trực tiếp với AI.

### Backend
- Node.js theo mô hình serverless function.
- API xử lý đăng nhập, hồ sơ người dùng, lịch sử chat, tính toán dinh dưỡng và cập nhật thực đơn.
- Kiến trúc phù hợp để triển khai trên Vercel, dễ mở rộng và tối ưu chi phí cho sản phẩm AI.

### AI
- Tích hợp OpenAI API để:
  - phân tích món ăn từ ảnh,
  - trả lời câu hỏi dinh dưỡng theo ngữ cảnh người dùng,
  - sinh thực đơn tuần,
  - điều chỉnh kế hoạch ăn uống khi người dùng ăn lệch so với lộ trình.
- Áp dụng prompt engineering để AI phản hồi đúng vai trò AI Coach, giữ ngữ cảnh cá nhân hóa và đưa ra kết quả có cấu trúc.

### Database và xác thực
- Supabase dùng cho xác thực tài khoản người dùng.
- Supabase Database dùng để lưu hồ sơ cá nhân, lịch sử trò chuyện, trạng thái setup và kế hoạch ăn uống.
- Token xác thực được dùng để bảo vệ các API cần đăng nhập.

### Kỹ thuật nổi bật
- Tính toán dinh dưỡng theo BMR, TDEE và calories mục tiêu.
- Lưu lịch sử hội thoại để duy trì ngữ cảnh trong các phiên chat với AI.
- Hỗ trợ workflow đa bước: nhận diện món ăn, hỏi thêm thời điểm ăn, xác nhận bữa ăn, rồi mới cập nhật kế hoạch.
- Kết hợp giữa dữ liệu định lượng dinh dưỡng và hội thoại AI để tạo trải nghiệm cá nhân hóa sâu hơn.

## Định hướng sử dụng
Calorie AI phù hợp với người dùng muốn:
- giảm cân hoặc kiểm soát calories khoa học,
- tăng cân hoặc tăng cơ có định hướng,
- xây dựng kế hoạch ăn uống rõ ràng theo tuần,
- theo dõi tiến độ sức khỏe bằng dữ liệu thay vì cảm giác chủ quan,
- nhận hỗ trợ dinh dưỡng tức thời từ AI trong quá trình sinh hoạt hằng ngày.

## Triển khai
Dự án được thiết kế để triển khai trên Vercel, phù hợp với mô hình web app serverless tích hợp AI và cơ sở dữ liệu đám mây.

## Nhóm tác giả
**Tác giả:** Vũ Trí Việt (Le Hong Phong High School for the Gifted)<br>
**Đồng tác giả:** Hồng Tú Quỳnh (Tran Dai Nghia High School for the Gifted)<br>


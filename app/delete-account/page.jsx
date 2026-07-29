/**
 * /delete-account — Trang công khai hướng dẫn xoá tài khoản Dr.Fit.
 * 
 * Tuân thủ 100% quy định Google Play Console:
 *   • KHÔNG cần đăng nhập (Public Route)
 *   • KHÔNG dùng PageShell (Hoàn toàn độc lập, không SideNav/Header app)
 *   • Server Component tĩnh (Không client JS, load tức thì)
 * 
 * Luồng ứng dụng chính xác: Hồ sơ → Cài đặt → Xoá tài khoản
 */

import Link from 'next/link';
import '../../styles/delete-account.css';

export const metadata = {
  title: 'Xoá tài khoản Dr.Fit | Delete Your Dr.Fit Account',
  description:
    'Hướng dẫn chi tiết cách xoá tài khoản Dr.Fit và dữ liệu cá nhân theo chính sách Google Play. How to delete your Dr.Fit account and associated data.',
};

const STEPS = [
  {
    num: 1,
    vi: 'Mở ứng dụng Dr.Fit',
    en: 'Open the Dr.Fit app',
    descVi: 'Mở ứng dụng Dr.Fit trên điện thoại iOS hoặc Android của bạn.',
    descEn: 'Launch the Dr.Fit app on your iOS or Android mobile device.',
  },
  {
    num: 2,
    vi: 'Vào mục Hồ sơ',
    en: 'Go to Profile',
    descVi: 'Nhấn vào biểu tượng Hồ sơ (Profile) ở thanh menu điều hướng bên dưới.',
    descEn: 'Tap the Profile icon located on the bottom navigation bar.',
  },
  {
    num: 3,
    vi: 'Mở Cài đặt',
    en: 'Open Settings',
    descVi: 'Chọn biểu tượng Cài đặt (bánh răng) ở góc trên màn hình Hồ sơ.',
    descEn: 'Tap the Settings gear icon at the top corner of the Profile screen.',
  },
  {
    num: 4,
    vi: 'Chọn Xoá tài khoản',
    en: 'Tap Delete Account',
    descVi: 'Cuộn xuống cuối mục Cài đặt và chọn "Xoá tài khoản".',
    descEn: 'Scroll down to the bottom of Settings and select "Delete Account".',
  },
  {
    num: 5,
    vi: 'Xác nhận xoá',
    en: 'Confirm deletion',
    descVi: 'Đọc kỹ thông báo cảnh báo và nhấn nút xác nhận để hoàn tất.',
    descEn: 'Read the warning details and tap confirm to complete the request.',
  },
];

const DELETED_ITEMS = [
  { vi: 'Thông tin tài khoản', en: 'Account Information', desc: 'Họ tên, email, số điện thoại, ảnh đại diện, ID tài khoản' },
  { vi: 'Hồ sơ cá nhân & chỉ số', en: 'Profile & Body Metrics', desc: 'Chiều cao, cân nặng, độ tuổi, chỉ số BMI, TDEE, BMR' },
  { vi: 'Hồ sơ dinh dưỡng', en: 'Nutrition Profile', desc: 'Mục tiêu calo, phân bổ Macro (Protein/Carb/Fat), chế độ ăn' },
  { vi: 'Lịch sử bữa ăn & thực đơn', en: 'Meal History & Menus', desc: 'Nhật ký ăn uống hàng ngày, thực đơn tùy chỉnh, lịch sử ghi chép' },
  { vi: 'Ảnh món ăn đã tải lên', en: 'Uploaded Food Photos', desc: 'Toàn bộ hình ảnh thực phẩm bạn đã chụp hoặc tải lên AI nhận diện' },
  { vi: 'Lịch sử trò chuyện AI', en: 'AI Nutrition Conversations', desc: 'Nội dung trao đổi, tư vấn dinh dưỡng với trợ lý AI' },
  { vi: 'Liên kết gia đình', en: 'Family Links', desc: 'Kết nối theo dõi sức khỏe giữa các thành viên gia đình' },
  { vi: 'Tuỳ chọn cá nhân', en: 'Personal Preferences', desc: 'Cài đặt thông báo, chủ đề giao diện, cấu hình cá nhân' },
];

export default function DeleteAccountPage() {
  return (
    <main className="dap">
      {/* Top Bar / Header */}
      <header className="dap-head">
        <div className="dap-head-inner">
          <div className="dap-brand">
           <Link href="/diet-details" className="logo"> <img src="/banner.png" alt="Dr.Fit Logo" className="dap-logo" /> </Link>
          </div>
          <div className="dap-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            <span>Google Play Policy Compliant</span>
          </div>
        </div>
      </header>

      <div className="dap-body">
        {/* Title Hero */}
        <section className="dap-hero">
          <div className="dap-hero-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"/>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h1>
            Xoá tài khoản & Dữ liệu
            <span>Delete Account & Personal Data</span>
          </h1>
          <p className="dap-lead">
            Dr.Fit tôn trọng tuyệt đối quyền riêng tư và quyền kiểm soát dữ liệu của bạn.
            Bạn có thể dễ dàng yêu cầu xoá toàn bộ tài khoản và thông tin liên quan bất kỳ lúc nào.
            <span className="dap-lead-en">
              At Dr.Fit, we fully respect your privacy and data ownership. You can easily request the complete deletion of your account and associated data at any time.
            </span>
          </p>
        </section>

        {/* Section 1: How to Delete (Step-by-step) */}
        <section className="dap-card">
          <div className="dap-card-header">
            <div className="dap-card-icon green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div>
              <h2>
                <span className="dap-step-num">1. Quyền thực hiện trong ứng dụng</span>
                <em>How to delete your account in app</em>
              </h2>
              <p className="dap-card-sub">
                Thực hiện 5 bước đơn giản trực tiếp trong ứng dụng Dr.Fit trên di động:
                <span className="en-sub">Follow these 5 simple steps directly inside the Dr.Fit mobile app:</span>
              </p>
            </div>
          </div>

          <div className="dap-flow">
            {STEPS.map((step) => (
              <div key={step.num} className="dap-step-item">
                <div className="dap-step-badge">{step.num}</div>
                <div className="dap-step-content">
                  <div className="dap-step-title">
                    <h3>{step.vi}</h3>
                    <span className="dap-step-en">{step.en}</span>
                  </div>
                  <p className="dap-step-desc">
                    {step.descVi}
                    <span className="en-desc">{step.descEn}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="dap-app-path-summary">
            <span className="dap-path-label">Luồng thực hiện nhanh / Quick Path:</span>
            <div className="dap-path-pills">
              <span>Hồ sơ (Profile)</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
              <span>Cài đặt (Settings)</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
              <span className="highlight">Xoá tài khoản (Delete Account)</span>
            </div>
          </div>
        </section>

        {/* Section 2: Deleted Data Grid */}
        <section className="dap-card">
          <div className="dap-card-header">
            <div className="dap-card-icon red">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </div>
            <div>
              <h2>
                <span className="dap-step-num">2. Dữ liệu sẽ bị xoá vĩnh viễn</span>
                <em>Data that will be permanently deleted</em>
              </h2>
              <p className="dap-card-sub">
                Khi xác nhận xoá tài khoản, tất cả dữ liệu bên dưới sẽ bị gỡ bỏ hoàn toàn khỏi hệ thống:
                <span className="en-sub">When you confirm deletion, all data listed below will be completely removed from our systems:</span>
              </p>
            </div>
          </div>

          <div className="dap-grid">
            {DELETED_ITEMS.map((item, idx) => (
              <div key={idx} className="dap-grid-card">
                <div className="dap-grid-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div className="dap-grid-info">
                  <h4>
                    {item.vi}
                    <em>{item.en}</em>
                  </h4>
                  <p>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3 & 4: Retention & Processing Time Grid */}
        <div className="dap-two-col">
          {/* Section 3: Data Retained */}
          <section className="dap-card col-item">
            <div className="dap-card-header compact">
              <div className="dap-card-icon amber">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <h2>
                <span className="dap-step-num">3. Dữ liệu giữ lại</span>
                <em>Data retained</em>
              </h2>
            </div>
            <div className="dap-info-body">
              <p>
                Dr.Fit <strong>không lưu giữ</strong> bất kỳ dữ liệu cá nhân nào sau khi tài khoản đã bị xoá, trừ trường hợp cơ quan nhà nước hoặc pháp luật có thẩm quyền yêu cầu duy trì.
              </p>
              <p className="dap-note-box">
                Nếu phải lưu trữ tạm thời vì lý do pháp lý hoặc an ninh hệ thống, thời hạn lưu trữ tối đa không vượt quá <strong>30 ngày</strong>.
              </p>
              <p className="dap-en-block">
                Dr.Fit does not retain personal account data after deletion except where legally required. If temporary retention is required by law or security policies, it will not exceed 30 days.
              </p>
            </div>
          </section>

          {/* Section 4: Processing Time */}
          <section className="dap-card col-item">
            <div className="dap-card-header compact">
              <div className="dap-card-icon blue">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h2>
                <span className="dap-step-num">4. Thời gian xử lý</span>
                <em>Processing time</em>
              </h2>
            </div>
            <div className="dap-info-body">
              <p>
                Yêu cầu xoá tài khoản sẽ có hiệu lực <strong>ngay lập tức</strong> đối với ứng dụng và cơ sở dữ liệu truy cập trực tuyến.
              </p>
              <p className="dap-note-box blue-tint">
                Các bản sao lưu dự phòng (Backups) sẽ tự động ghi đè và hết hạn hoàn toàn trong vòng tối đa <strong>30 ngày</strong>.
              </p>
              <p className="dap-en-block">
                Account deletion takes effect immediately for online app services. Offline encrypted storage backups will expire completely within 30 days.
              </p>
            </div>
          </section>
        </div>

        {/* Section 5: Contact & Support */}
        <section className="dap-card dap-contact-card">
          <div className="dap-card-header">
            <div className="dap-card-icon purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <div>
              <h2>
                <span className="dap-step-num">5. Hỗ trợ & Trợ giúp</span>
                <em>Support & Assistance</em>
              </h2>
              <p className="dap-card-sub">
                Nếu gặp khó khăn khi đăng nhập hoặc cần trợ giúp xoá tài khoản:
                <span className="en-sub">If you have trouble logging in or need help deleting your account:</span>
              </p>
            </div>
          </div>

          <div className="dap-support-info">
            <p>
              Vui lòng truy cập trang trợ giúp trong ứng dụng hoặc gửi yêu cầu cho bộ phận hỗ trợ khách hàng của Dr.Fit qua kênh liên hệ chính thức trong app.
              <span className="dap-en-inline">Please contact customer support through the official contact options in the Dr.Fit application.</span>
            </p>
          </div>
        </section>

        {/* Web Delete CTA Banner */}
        <div className="dap-cta">
          <div className="dap-cta-content">
            <div className="dap-cta-badge">Web Portal Action</div>
            <h3>
              Đang sử dụng Dr.Fit trên trình duyệt Web?
              <span>Signed in on the web browser?</span>
            </h3>
            <p>
              Bạn có thể tiến hành gỡ bỏ tài khoản trực tiếp trong trang Cài đặt tài khoản web.
              <span className="dap-cta-sub-en">You can proceed to delete your account directly inside web Settings.</span>
            </p>
          </div>
          <Link href="/settings" className="dap-btn">
            <span>Mở Cài đặt · Open Settings</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="dap-foot">
        <div className="dap-foot-inner">
          <div className="dap-foot-brand">
            <span className="dap-foot-logo">Dr.Fit</span>
            <span className="dap-foot-copy">© {new Date().getFullYear()} Dr.Fit Health. All rights reserved.</span>
          </div>
          <div className="dap-foot-links">
            <span className="dap-foot-tag">Google Play Safety Portal</span>
            <Link href="/" className="dap-foot-link">
              Trang chủ · Home
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
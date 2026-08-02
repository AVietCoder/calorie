'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import TemplateCard from '../../components/menu-library/TemplateCard';
import TemplateDetail from '../../components/menu-library/TemplateDetail';
import TemplateEditor from '../../components/menu-library/TemplateEditor';
import ActiveMenuBanner from '../../components/menu-library/ActiveMenuBanner';
import ManualMenuBuilder from '../../components/menu-library/ManualMenuBuilder';
import { MENU_CATEGORIES } from '../../lib/family-menu/menu-categories';
import '../../styles/modal.css';
import '../../styles/menu-library.css';
import '../../styles/day-notes.css';

/** Tên tiếng Việt của các bố cục mà bộ nhập nhận diện được. */
const LAYOUT_LABELS = {
  'pivot': 'Ngày × Bữa ăn',
  'record': 'Bản ghi (ngày, bữa, món)',
  'single-meal': 'Một bữa × nhiều ngày',
  'menu-catalog': 'Danh sách thực đơn đánh số',
  'meal-rows': 'Thực đơn 1 ngày theo bữa',
  'legacy-flat': 'Mẫu 16 cột',
};

export default function MenuLibraryPage() {
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ranked, setRanked] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [selectedCat, setSelectedCat] = useState(null);
  const [detail, setDetail] = useState(null);       // template đang xem chi tiết
  const [editing, setEditing] = useState(null);     // template đang sửa (Ảnh 3)
  const [isAdmin, setIsAdmin] = useState(false);
  const [shopping, setShopping] = useState(null);   // checklist của thực đơn đang xem
  const [manualOpen, setManualOpen] = useState(false);
  const [form, setForm] = useState({ title: '', tags: '', disease: '', visibility: 'public' });
  const [importReport, setImportReport] = useState(null);

  const fileInputRef = useRef(null);
  const uploadRef = useRef(null);
  const { get, post, postForm, download } = useApi();
  const showToast = useToast();
  const { t, tn } = useTranslation();
  const router = useRouter();

  async function loadTemplates(tag) {
    const data = await get('/api/family-menu', { resource: 'templates', ...(tag ? { tag } : {}) });
    // API mới trả { items, active_template_id, ... }; mảng trần là dạng cũ.
    const items = Array.isArray(data) ? data : (data?.items || []);
    setRanked(items);
    if (!Array.isArray(data)) {
      setActiveTemplateId(data?.active_template_id || null);
      setIsAdmin(!!data?.is_admin);
    }
  }

  /* ── sửa / xoá thực đơn (Ảnh 3) ────────────────────────────────────── */

  /** Quyền sửa của một template id — lấy từ chính `can_edit` API đã trả. */
  const canEditId = (id) => !!ranked.find((r) => r.template.id === id)?.can_edit;

  async function saveTemplate(patch, file) {
    const id = editing.id;
    // Có ảnh mới thì phải đi multipart; không thì gửi JSON cho nhẹ.
    if (file) {
      const fd = new FormData();
      fd.append('action', 'update_template');
      fd.append('template_id', id);
      for (const [k, v] of Object.entries(patch)) fd.append(k, String(v));
      fd.append('file', file);
      await postForm('/api/family-menu', fd);
    } else {
      await post('/api/family-menu', { action: 'update_template', template_id: id, ...patch });
    }
    showToast(t('ml.toast_saved', 'Đã lưu thực đơn!'), 'success');
    setEditing(null);
    await loadTemplates(null);
    // Đang mở chi tiết chính thực đơn vừa sửa thì nạp lại để thấy ngay thay đổi.
    if (detail?.id === id) {
      setDetail(await get('/api/family-menu', { resource: 'template', id }));
    }
  }

  async function removeTemplate() {
    const id = editing.id;
    if (!window.confirm(tn(
      'ml.confirm_delete',
      { title: editing.title },
      `Xoá thực đơn "${editing.title}"?\n\nThực đơn sẽ biến mất khỏi thư viện. `
      + `Kế hoạch ăn đã tạo từ nó vẫn được giữ nguyên.`
    ))) return;
    try {
      await post('/api/family-menu', { action: 'delete_template', template_id: id });
      showToast(t('ml.toast_deleted', 'Đã xoá thực đơn.'), 'success');
      setEditing(null);
      if (detail?.id === id) setDetail(null);
      await loadTemplates(null);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  /** Mở màn chi tiết — nạp đầy đủ ngày/bữa/món của thực đơn. */
  async function openDetail(item) {
    try {
      const id = item.template.id;
      const full = await get('/api/family-menu', { resource: 'template', id });
      setDetail({ ...full, category: full.category ?? item.template.category });
      setShopping(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Checklist nạp SAU và không chặn: món ăn hiện ngay, phần đi chợ điền vào
      // khi có. Hỏng thì chỉ khối checklist báo lỗi, không mất cả trang.
      get('/api/family-menu', { resource: 'template-shopping-list', id })
        .then((list) => setShopping((cur) => (cur === null ? list : cur)))
        .catch((e) => setShopping({ error: e.message }));
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }
    (async () => {
      try {
        const data = await get('/api/family-menu', { resource: 'household' });
        const h = data?.household || null;
        setHousehold(h);
        if (h) await loadTemplates(null);
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /**
   * Áp dụng một thực đơn. Nếu gia đình ĐANG dùng thực đơn khác thì phải xác
   * nhận trước — đổi thực đơn sẽ thay thế toàn bộ kế hoạch ăn hiện tại.
   */
  async function applyTemplate(templateId, title) {
    if (activeTemplateId && activeTemplateId !== templateId) {
      const current = ranked.find((r) => r.template.id === activeTemplateId)?.template?.title
        || t('ml.current_menu', 'thực đơn hiện tại');
      const msg = tn(
        'ml.confirm_switch',
        { from: current, to: title },
        `Bạn chắc chắn muốn đổi thực đơn?\n\n`
        + `Bạn đang sử dụng "${current}". Nếu chuyển sang "${title}", kế hoạch ăn hiện tại `
        + `sẽ được thay thế bằng thực đơn mới.\n\nBạn có chắc chắn muốn tiếp tục?`
      );
      if (!window.confirm(msg)) return;
    }

    try {
      const plan = await post('/api/family-menu', {
        action: 'generate_plan', household_id: household.id, template_id: templateId,
      });
      showToast(t('ml.toast_generated', 'Đã tạo thực đơn cho gia đình!'), 'success');
      router.push(`/menu-plan?household_id=${household.id}&plan_id=${plan.id}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // File mẫu nay do SERVER dựng (lib/excel/templates/import-template.js) nên
  // mang đúng bộ nhận diện của hệ thống và có thêm sheet HƯỚNG DẪN. Bỏ hẳn
  // việc dựng bằng SheetJS ở client — SheetJS bản cộng đồng không ghi được
  // style, và giữ hai nơi định nghĩa cột là nguồn gốc của lệch chuẩn.
  async function downloadTemplate() {
    try {
      await download('/api/family-menu', { resource: 'import-template' }, 'drfit-mau-nhap-thuc-don.xlsx');
      showToast(t('ml.template_downloaded', 'Đã tải file mẫu — điền theo mẫu rồi tải lên nhé!'), 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function uploadTemplate() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) { showToast(t('ml.toast_pick_excel', 'Chọn file Excel trước.'), 'error'); return; }
    const fd = new FormData();
    fd.append('action', 'upload_template_excel');
    fd.append('title', form.title.trim());
    fd.append('tags', form.tags.trim());
    fd.append('disease_target', form.disease.trim());
    fd.append('visibility', form.visibility);
    if (household) fd.append('household_id', household.id);
    fd.append('file', file);

    try {
      const created = await postForm('/api/family-menu', fd);
      const r = created?.import_report;
      // Cho người dùng thấy hệ thống đã HIỂU file thế nào, thay vì chỉ báo
      // "thành công" rồi để họ tự mở lên kiểm tra.
      setImportReport(r || null);
      showToast(
        r
          // Số liệu nằm NGOÀI t() — nhét vào chuỗi fallback thì bản dịch nào
          // cũng nuốt mất dayCount/dishCount.
          ? `${t('ml.ir_scope', 'Đã nhập')} ${r.dayCount} ${t('ml.ir_days', 'ngày')} · ${r.dishCount} ${t('ml.ir_dishes', 'món')} (${t('ml.ir_layout', 'Bố cục')}: ${LAYOUT_LABELS[r.layout] || r.strategy})`
          : t('ml.toast_added', 'Đã thêm menu vào thư viện!'),
        'success'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      setForm((f) => ({ ...f, title: '' }));
      await loadTemplates(null);
    } catch (e) {
      setImportReport(null);
      showToast(e.message, 'error');
    }
  }

  // Chỉ hiện những danh mục THỰC SỰ có thực đơn — tránh dãy chip rỗng.
  const catIds = new Set(ranked.map((r) => r.template.category).filter(Boolean));
  const usedCategories = MENU_CATEGORIES.filter((c) => catIds.has(c.id));
  const visible = selectedCat ? ranked.filter((r) => r.template.category === selectedCat) : ranked;
  const activeItem = ranked.find((r) => r.template.id === activeTemplateId) || null;

  /** Kéo màn hình xuống form tải Excel và focus luôn ô chọn file. */
  function jumpToUpload() {
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => fileInputRef.current?.focus(), 400);
  }

  async function createManual(payload) {
    const created = await post('/api/family-menu', { action: 'create_template_manual', ...payload });
    setImportReport(created?.import_report || null);
    showToast(t('ml.toast_added', 'Đã thêm menu vào thư viện!'), 'success');
    setManualOpen(false);
    await loadTemplates(null);
  }

  if (loading) {
    return (
      <PageShell>
        <div className="loading-overlay" style={{ position: 'fixed' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-book-open" /></div>
          <div>
            <h1>{t('ml.title', 'Thư viện thực đơn chuẩn')}</h1>
            <p>{t('ml.subtitle', 'AI chọn thực đơn phù hợp nhất với gia đình bạn từ thư viện có sẵn — không tự bịa món')}</p>
          </div>
        </div>
      </div>

      {!household ? (
        <div className="card">
          <p>{t('fm.need_household', 'Bạn cần tạo hồ sơ gia đình trước.')} <Link href="/household">{t('fm.create_now', 'Tạo ngay →')}</Link></p>
        </div>
      ) : detail ? (
        <TemplateDetail
          template={detail}
          inUse={detail.id === activeTemplateId}
          onBack={() => { setDetail(null); setShopping(null); }}
          shopping={shopping}
          t={t}
          actions={
            <>
              {canEditId(detail.id) && (
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(detail)}>
                  <i className="fa-solid fa-pen" /> {t('ml.edit', 'Sửa')}
                </button>
              )}
              {detail.id === activeTemplateId ? (
                <ActionButton className="btn btn-secondary" onClick={() => router.push(`/menu-plan?household_id=${household.id}`)}>
                  <i className="fa-solid fa-arrow-right" /> {t('ml.open_plan', 'Xem kế hoạch đang dùng')}
                </ActionButton>
              ) : (
                <ActionButton
                  className="btn btn-primary"
                  onClick={() => applyTemplate(detail.id, detail.title)}
                  loadingText={t('common.creating', 'Đang tạo...')}
                >
                  <i className="fa-solid fa-wand-magic-sparkles" /> {t('ml.generate', 'Dùng thực đơn này')}
                </ActionButton>
              )}
            </>
          }
        />
      ) : (
        <div>
          <ActiveMenuBanner
            active={activeItem}
            onOpen={openDetail}
            onUpload={jumpToUpload}
            onManual={() => setManualOpen(true)}
            t={t}
          />

          <div className="tag-filter">
            <span className={`tag-chip${!selectedCat ? ' selected' : ''}`} onClick={() => setSelectedCat(null)}>
              {t('ml.all', 'Tất cả')}
            </span>
            {usedCategories.map((c) => (
              <span
                key={c.id}
                className={`tag-chip${selectedCat === c.id ? ' selected' : ''}`}
                onClick={() => setSelectedCat(c.id)}
              >
                <i className={`fa-solid ${c.icon}`} style={{ marginRight: 6 }} /> {c.label}
              </span>
            ))}
          </div>

          <div className="ml-grid">
            {visible.length === 0 ? (
              <p style={{ color: 'var(--text-sub)' }}>
                {t('ml.empty', 'Chưa có thực đơn nào trong thư viện — hãy tải lên một menu mới ở dưới.')}
              </p>
            ) : (
              visible.map((r) => (
                <TemplateCard
                  key={r.template.id}
                  item={r}
                  onOpen={openDetail}
                  onEdit={(it) => setEditing(it.template)}
                  t={t}
                />
              ))
            )}
          </div>

          <div className="section-title" ref={uploadRef}>
            <h2>{t('ml.add_title', 'Tự thêm menu vào thư viện')}</h2>
            <p>{t('ml.add_sub', 'Tải lên Excel hoặc nhập tay — mặc định công khai cho mọi người dùng')}</p>
          </div>
          <div className="card">
            <div className="ml-add-switch">
              <button type="button" className="btn btn-secondary" onClick={() => setManualOpen(true)}>
                <i className="fa-solid fa-keyboard" /> {t('ml.start_manual', 'Tự nhập thực đơn')}
              </button>
              <small>{t('ml.add_or', 'hoặc tải lên file Excel ở dưới')}</small>
            </div>

            <div className="upload-row">
              <label>{t('ml.f_name', 'Tên menu')} <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={t('ml.f_name_ph', 'Menu giảm cân 7 ngày')} /></label>
              <label>{t('ml.f_tags', 'Nhãn (phân cách bằng dấu phẩy)')} <input type="text" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="goal:lose, region:mien-nam" /></label>
              <label>{t('ml.f_disease', 'Bệnh lý hướng đến')} <input type="text" value={form.disease} onChange={(e) => setForm((f) => ({ ...f, disease: e.target.value }))} placeholder={t('ml.f_disease_ph', 'tiểu đường, gout...')} /></label>
              <label>{t('ml.f_scope', 'Phạm vi')}
                <select value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}>
                  <option value="public">{t('ml.scope_public', 'Công khai (mặc định)')}</option>
                  <option value="private">{t('ml.scope_private', 'Chỉ gia đình tôi')}</option>
                </select>
              </label>
            </div>
            <div className="upload-row">
              <label>{t('ml.f_excel', 'File Excel (.xlsx)')} <input ref={fileInputRef} type="file" accept=".xlsx,.xls" /></label>
              <div style={{ display: 'flex', gap: 10, alignSelf: 'flex-end', flexWrap: 'wrap' }}>
                <ActionButton className="btn btn-secondary" onClick={downloadTemplate}><i className="fa-solid fa-file-arrow-down" /> {t('ml.download_template', 'Tải file mẫu (.xlsx)')}</ActionButton>
                <ActionButton className="btn btn-primary" onClick={uploadTemplate} loadingText={t('common.uploading', 'Đang tải lên...')}><i className="fa-solid fa-upload" /> {t('ml.upload_btn', 'Tải lên')}</ActionButton>
              </div>
            </div>
            <p style={{ color: 'var(--text-sub)', fontSize: 13, marginTop: 8 }}>
              {t('ml.excel_free', 'Bạn có thể tải lên file thực đơn bất kỳ (dạng bảng Ngày × Bữa ăn) — hệ thống tự nhận diện cấu trúc. Hoặc dùng file mẫu 16 cột để nhập đầy đủ dinh dưỡng và nguyên liệu.')}
            </p>

            {importReport && (
              <div className="import-report">
                <h4><i className="fa-solid fa-circle-check" /> {t('ml.import_ok', 'Kết quả nhận diện')}</h4>
                <ul>
                  <li>{t('ml.ir_layout', 'Bố cục')}: <strong>{LAYOUT_LABELS[importReport.layout] || importReport.strategy}</strong> {importReport.strategy === 'ai' && <em>({t('ml.ir_by_ai', 'do AI nhận diện')})</em>}</li>
                  <li>{t('ml.ir_scope', 'Đã nhập')}: <strong>{importReport.dayCount}</strong> {t('ml.ir_days', 'ngày')} · <strong>{importReport.dishCount}</strong> {t('ml.ir_dishes', 'món')}</li>
                  <li>{t('ml.ir_confidence', 'Độ tin cậy')}: <strong>{Math.round((importReport.confidence || 0) * 100)}%</strong></li>
                  {importReport.sheet && <li>{t('ml.ir_sheet', 'Sheet')}: {importReport.sheet}</li>}
                </ul>
                {importReport.warnings?.length > 0 && (
                  <ul className="import-warnings">
                    {importReport.warnings.map((w, i) => <li key={i}><i className="fa-solid fa-triangle-exclamation" /> {w}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {manualOpen && (
        <ManualMenuBuilder
          household={household}
          onCancel={() => setManualOpen(false)}
          onSubmit={createManual}
          t={t}
        />
      )}

      {editing && (
        <TemplateEditor
          template={editing}
          isAdmin={isAdmin}
          onCancel={() => setEditing(null)}
          onSave={saveTemplate}
          onDelete={removeTemplate}
          t={t}
          tn={tn}
        />
      )}
    </PageShell>
  );
}

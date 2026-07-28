'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/menu-library.css';

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
  const [selectedTag, setSelectedTag] = useState(null);
  const [form, setForm] = useState({ title: '', tags: '', disease: '', visibility: 'public' });
  const [importReport, setImportReport] = useState(null);

  const fileInputRef = useRef(null);
  const { get, post, postForm, download } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  async function loadTemplates(tag) {
    const data = await get('/api/family-menu', { resource: 'templates', ...(tag ? { tag } : {}) });
    setRanked(Array.isArray(data) ? data : []);
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

  async function onSelectTag(tag) {
    setSelectedTag(tag);
    try { await loadTemplates(tag); } catch (e) { showToast(e.message, 'error'); }
  }

  async function generatePlanFromTemplate(templateId) {
    try {
      const plan = await post('/api/family-menu', { action: 'generate_plan', household_id: household.id, template_id: templateId });
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
      await download('/api/family-menu', { resource: 'import-template' }, 'calorie-ai-mau-nhap-thuc-don.xlsx');
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
          ? t('ml.toast_added_detail', `Đã nhập ${r.dayCount} ngày · ${r.dishCount} món (bố cục: ${LAYOUT_LABELS[r.layout] || r.strategy})`)
          : t('ml.toast_added', 'Đã thêm menu vào thư viện!'),
        'success'
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      setForm((f) => ({ ...f, title: '' }));
      await loadTemplates(selectedTag);
    } catch (e) {
      setImportReport(null);
      showToast(e.message, 'error');
    }
  }

  const tags = new Set();
  for (const r of ranked) for (const tg of r.template.tags || []) tags.add(tg);

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
      ) : (
        <div>
          <div className="tag-filter">
            <span className={`tag-chip${!selectedTag ? ' selected' : ''}`} onClick={() => onSelectTag(null)}>{t('ml.all', 'Tất cả')}</span>
            {[...tags].map((tg) => (
              <span key={tg} className={`tag-chip${selectedTag === tg ? ' selected' : ''}`} onClick={() => onSelectTag(tg)}>{tg}</span>
            ))}
          </div>

          <div className="template-grid">
            {ranked.length === 0 ? (
              <p style={{ color: 'var(--text-sub)' }}>{t('ml.empty', 'Chưa có thực đơn phù hợp trong thư viện — hãy tải lên một menu mới ở dưới.')}</p>
            ) : (
              ranked.map((r) => (
                <div className="template-card" key={r.template.id}>
                  <span className="tpl-score">{t('ml.score', 'Độ phù hợp')}: {r.score}</span>
                  <h4>{r.template.title}</h4>
                  <div className="tpl-tags">{(r.template.tags || []).map((tg, i) => <span className="tpl-tag" key={i}>{tg}</span>)}</div>
                  <ActionButton className="btn btn-primary" onClick={() => generatePlanFromTemplate(r.template.id)} loadingText={t('common.creating', 'Đang tạo...')}>
                    <i className="fa-solid fa-wand-magic-sparkles" /> {t('ml.generate', 'Tạo thực đơn cho gia đình')}
                  </ActionButton>
                </div>
              ))
            )}
          </div>

          <div className="section-title">
            <h2>{t('ml.add_title', 'Tự thêm menu vào thư viện')}</h2>
            <p>{t('ml.add_sub', 'Tải lên Excel hoặc nhập tay — mặc định công khai cho mọi người dùng')}</p>
          </div>
          <div className="card">
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
    </PageShell>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/menu-library.css';

export default function MenuLibraryPage() {
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ranked, setRanked] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [form, setForm] = useState({ title: '', tags: '', disease: '', visibility: 'public' });

  const fileInputRef = useRef(null);
  const { get, post, postForm } = useApi();
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
      await postForm('/api/family-menu', fd);
      showToast(t('ml.toast_added', 'Đã thêm menu vào thư viện!'), 'success');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setForm((f) => ({ ...f, title: '' }));
      await loadTemplates(selectedTag);
    } catch (e) {
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
                  <button className="btn btn-primary" onClick={() => generatePlanFromTemplate(r.template.id)}>
                    <i className="fa-solid fa-wand-magic-sparkles" /> {t('ml.generate', 'Tạo thực đơn cho gia đình')}
                  </button>
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
              <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} onClick={uploadTemplate}><i className="fa-solid fa-upload" /> {t('ml.upload_btn', 'Tải lên')}</button>
            </div>
            <p style={{ color: 'var(--text-sub)', fontSize: 13, marginTop: 8 }}>
              {t('ml.excel_cols', 'Cột Excel')}: day_index, meal_type, dish_name, base_grams, calories, protein, fat, carbs, fiber, sugar, sodium, dish_tags, ingredient_name, ingredient_grams, ingredient_unit, ingredient_tags
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}

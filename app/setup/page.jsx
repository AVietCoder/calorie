'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import { isValidBirthYear, isValidHeight, isValidWeight } from '../../lib/body-metrics';
import '../../styles/setup.css';

const STEP_IDS = ['step1', 'step2', 'step3', 'step4'];
const GOAL_ITEMS = [
  { val: 'lose', icon: 'fa-arrow-trend-down', key: 'setup.goal_lose', fallback: 'Giảm cân' },
  { val: 'maintain', icon: 'fa-scale-balanced', key: 'setup.goal_maintain', fallback: 'Giữ cân' },
  { val: 'gain', icon: 'fa-arrow-trend-up', key: 'setup.goal_gain', fallback: 'Tăng cân' },
  { val: 'muscle', icon: 'fa-dumbbell', key: 'setup.goal_muscle', fallback: 'Tăng cơ' },
];
const DISEASE_OPTIONS = [
  { val: '', key: 'setup.disease_pick', fallback: '-- Chọn bệnh --' },
  { val: 'Gout', key: 'disease.gout', fallback: 'Gout' },
  { val: 'Tiểu đường', key: 'disease.diabetes', fallback: 'Tiểu đường' },
  { val: 'Huyết áp cao', key: 'disease.hypertension', fallback: 'Huyết áp cao' },
  { val: 'Mỡ máu cao', key: 'disease.high_cholesterol', fallback: 'Mỡ máu cao' },
  { val: 'Gan nhiễm mỡ', key: 'disease.fatty_liver', fallback: 'Gan nhiễm mỡ' },
  { val: 'Bệnh dạ dày', key: 'disease.stomach', fallback: 'Bệnh dạ dày' },
  { val: 'Bệnh thận', key: 'disease.kidney', fallback: 'Bệnh thận' },
  { val: 'Khác', key: 'disease.other', fallback: 'Khác' },
];
const DISEASE_VALUES = DISEASE_OPTIONS.map((d) => d.val);

const DEFAULT_FORM = {
  gender: 'male', birth_year: '', height: '', weight: '',
  target_weight: '', deadline: '', speed: 'safe',
  activity: '1.2', cheat_days: '', snacking: 'no',
  allergies: '', focus_macro: 'balanced', reason: '',
  disease_select: '', customDisease: '',
};

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupInner />
    </Suspense>
  );
}

function SetupInner() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [selectedGoals, setSelectedGoals] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [showExtendBanner, setShowExtendBanner] = useState(false);

  const { get, post } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const setField = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  function toggleGoal(val) {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }

  const finalDisease = selectedGoals.has('disease')
    ? (form.disease_select === 'Khác' ? form.customDisease.trim() : form.disease_select)
    : '';

  useEffect(() => {
    if (searchParams.get('mode') === 'extend') setShowExtendBanner(true);

    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) {
      showToast(t('common.please_login', 'Vui lòng đăng nhập!'), 'info');
      setTimeout(() => router.push('/signin'), 1369);
      return;
    }

    (async () => {
      try {
        const data = await get('/api/diet-info');
        const p = data?.profile;
        if (p) {
          if (p.deadline) {
            const d = new Date(p.deadline);
            d.setHours(23, 59, 59, 999);
            if (new Date() > d) setShowExtendBanner(true);
          }
          setForm({
            gender: p.gender || 'male',
            birth_year: p.birth_year ?? '',
            height: p.height ?? '',
            weight: p.weight ?? '',
            target_weight: p.target_weight ?? '',
            deadline: p.deadline ?? '',
            speed: p.speed || 'safe',
            activity: String(p.activity_level ?? '1.2'),
            cheat_days: p.high_cal_days ?? '',
            snacking: p.snacking || 'no',
            allergies: p.allergies ?? '',
            focus_macro: p.focus_macro || 'balanced',
            reason: p.reason ?? '',
            disease_select: DISEASE_VALUES.includes((p.disease || '').trim()) ? (p.disease || '').trim() : (p.disease ? 'Khác' : ''),
            customDisease: DISEASE_VALUES.includes((p.disease || '').trim()) ? '' : (p.disease || ''),
          });
          if (p.goal) {
            setSelectedGoals(new Set(String(p.goal).split(',').map((g) => g.trim()).filter(Boolean)));
          }
        }
      } catch {
        // Chưa có dữ liệu cũ để khôi phục — giữ hành vi cũ (im lặng bỏ qua).
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validateStep() {
    const err = (msg) => {
      showToast(msg, 'error');
      return false;
    };
    const id = STEP_IDS[step];

    if (id === 'step1') {
      if (!form.birth_year) return err('Vui lòng nhập năm sinh.');
      if (!isValidBirthYear(form.birth_year)) return err('Năm sinh không hợp lệ.');
      if (!form.height || !isValidHeight(form.height)) return err('Chiều cao phải nằm trong khoảng 80 - 250 cm.');
      if (!form.weight || !isValidWeight(form.weight)) return err('Cân nặng phải nằm trong khoảng 20 - 300 kg.');
    }

    if (id === 'step2') {
      if (selectedGoals.size === 0) return err(t('setup.pick_goal', 'Vui lòng chọn ít nhất một mục tiêu.'));
      if (selectedGoals.has('disease')) {
        if (!form.disease_select) return err('Vui lòng chọn bệnh / tình trạng sức khỏe.');
        if (form.disease_select === 'Khác' && !form.customDisease.trim()) return err('Vui lòng nhập tên bệnh.');
        if (!finalDisease.trim()) return err('Vui lòng nhập bệnh / tình trạng sức khỏe.');
      }
      if (!form.target_weight || !isValidWeight(form.target_weight)) return err('Cân nặng mục tiêu phải nằm trong khoảng 20 - 300 kg.');
      if (!form.deadline) return err('Vui lòng chọn deadline.');
      const deadlineDate = new Date(form.deadline);
      deadlineDate.setHours(23, 59, 59, 999);
      if (deadlineDate <= new Date()) return err('Deadline phải là ngày trong tương lai.');
    }

    if (id === 'step3' && !form.activity) return err('Vui lòng chọn tần suất vận động.');

    return true;
  }

  function nextPrev(n) {
    if (n === 1 && !validateStep()) return;
    const next = step + n;
    if (next >= STEP_IDS.length) {
      submitForm();
      return;
    }
    setStep(Math.max(0, next));
  }

  async function submitForm() {
    // Chống double-submit: ref đồng bộ chặn cả 2 click liên tiếp trong 1 nhịp render.
    // Thành công → GIỮ khoá tới lúc chuyển trang; lỗi mới nhả để user thử lại.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        goal: Array.from(selectedGoals).join(','),
        disease: finalDisease,
      };
      await post('/api/setup', payload);
      showToast('Hoàn tất!', 'success');
      router.push('/diet-details');
    } catch (error) {
      showToast('Có lỗi xảy ra: ' + error.message, 'error');
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (loading) {
    return (
      <PageShell variant="setup">
        <div className="setup-card" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      </PageShell>
    );
  }

  const isLastStep = step === STEP_IDS.length - 1;

  return (
    <PageShell variant="setup">
      <div className="setup-card">
        {showExtendBanner && (
          <div style={{ background: 'var(--sage-50)', padding: 16, borderRadius: 16, marginBottom: 20, borderLeft: '4px solid var(--primary)' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--primary-deep)', fontWeight: 600 }}>
              <i className="fa-solid fa-medal" /> {t('setup.extend_banner', 'Chặng đường cũ đã hoàn thành. Hãy cập nhật cân nặng mới và đặt deadline mới nhé!')}
            </p>
          </div>
        )}

        <div className="progress-container">
          {STEP_IDS.map((id, i) => (
            <div key={id} className={`progress-step${i <= step ? ' active' : ''}`} />
          ))}
        </div>

        <form onSubmit={(e) => e.preventDefault()}>
          <div className={`step${step === 0 ? ' active' : ''}`}>
            <h2>{t('setup.body_title', 'Chỉ số cơ thể')}</h2>
            <p>{t('setup.body_desc', 'Để tính toán BMR và TDEE chính xác cho bạn.')}</p>
            <div className="form-grid">
              <div className="input-group">
                <label>{t('setup.gender', 'Giới tính')}</label>
                <select value={form.gender} onChange={setField('gender')}>
                  <option value="male">{t('setup.male', 'Nam')}</option>
                  <option value="female">{t('setup.female', 'Nữ')}</option>
                </select>
              </div>
              <div className="input-group">
                <label>{t('setup.birth', 'Năm sinh')}</label>
                <input type="number" value={form.birth_year} onChange={setField('birth_year')} placeholder="2000" />
              </div>
              <div className="input-group">
                <label>{t('setup.height', 'Chiều cao (cm)')}</label>
                <input type="number" value={form.height} onChange={setField('height')} placeholder="170" />
              </div>
              <div className="input-group">
                <label>{t('setup.weight', 'Cân nặng (kg)')}</label>
                <input type="number" value={form.weight} onChange={setField('weight')} placeholder="65" />
              </div>
            </div>
          </div>

          <div className={`step${step === 1 ? ' active' : ''}`}>
            <h2>{t('setup.goal_title', 'Mục tiêu của bạn')}</h2>
            <p>{t('setup.goal_desc', 'Bạn có thể chọn nhiều mục tiêu cùng lúc.')}</p>
            <div className="goal-options">
              {GOAL_ITEMS.map((g) => (
                <div key={g.val} className={`goal-item${selectedGoals.has(g.val) ? ' selected' : ''}`} onClick={() => toggleGoal(g.val)}>
                  <i className={`fa-solid ${g.icon}`} /><span>{t(g.key, g.fallback)}</span>
                </div>
              ))}
              <div className={`goal-item goal-wide${selectedGoals.has('disease') ? ' selected' : ''}`} onClick={() => toggleGoal('disease')}>
                <i className="fa-solid fa-stethoscope" />
                <span>{t('setup.goal_disease', 'Cải thiện / hỗ trợ điều trị bệnh')}</span>
              </div>
            </div>

            {selectedGoals.has('disease') && (
              <div className="input-group">
                <label>{t('setup.disease_label', 'Bệnh / tình trạng sức khỏe')}</label>
                <select value={form.disease_select} onChange={setField('disease_select')}>
                  {DISEASE_OPTIONS.map((d) => (
                    <option key={d.val} value={d.val}>{t(d.key, d.fallback)}</option>
                  ))}
                </select>
                {form.disease_select === 'Khác' && (
                  <input
                    type="text"
                    value={form.customDisease}
                    onChange={setField('customDisease')}
                    placeholder={t('setup.disease_other_ph', 'Nhập tên bệnh...')}
                    style={{ marginTop: 10 }}
                  />
                )}
              </div>
            )}

            <div className="form-grid" style={{ marginTop: 8 }}>
              <div className="input-group">
                <label>{t('setup.target_weight', 'Cân nặng mục tiêu')}</label>
                <input type="number" value={form.target_weight} onChange={setField('target_weight')} placeholder="60" />
              </div>
              <div className="input-group">
                <label>{t('setup.deadline', 'Deadline')}</label>
                <input type="date" value={form.deadline} onChange={setField('deadline')} />
              </div>
              <div className="input-group full">
                <label>{t('setup.speed', 'Tốc độ mong muốn')}</label>
                <select value={form.speed} onChange={setField('speed')}>
                  <option value="safe">{t('setup.speed_safe', 'An toàn (0.5kg/tuần)')}</option>
                  <option value="normal">{t('setup.speed_normal', 'Vừa phải (0.7kg/tuần)')}</option>
                  <option value="fast">{t('setup.speed_fast', 'Nhanh (1kg/tuần)')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className={`step${step === 2 ? ' active' : ''}`}>
            <h2>{t('setup.habit_title', 'Thói quen & Linh hoạt')}</h2>
            <p>{t('setup.habit_desc', 'Tối ưu hóa calo theo lịch trình của bạn.')}</p>
            <div className="input-group">
              <label>{t('setup.activity', 'Tần suất vận động')}</label>
              <select value={form.activity} onChange={setField('activity')}>
                <option value="1.2">{t('setup.act_1', 'Ít vận động (Văn phòng)')}</option>
                <option value="1.375">{t('setup.act_2', 'Nhẹ (1-2 buổi tập/tuần)')}</option>
                <option value="1.55">{t('setup.act_3', 'Vừa (3-5 buổi tập/tuần)')}</option>
                <option value="1.725">{t('setup.act_4', 'Nặng (6-7 buổi tập/tuần)')}</option>
              </select>
            </div>
            <div className="input-group">
              <label>{t('setup.cheat', 'Ngày ăn nhiều (Cheat day)?')}</label>
              <input type="text" value={form.cheat_days} onChange={setField('cheat_days')} placeholder={t('setup.cheat_ph', 'Ví dụ: Thứ 7 và Chủ Nhật')} />
            </div>
            <div className="input-group">
              <label>{t('setup.snack_q', 'Bạn có hay ăn vặt không?')}</label>
              <select value={form.snacking} onChange={setField('snacking')}>
                <option value="no">{t('setup.snack_no', 'Không bao giờ')}</option>
                <option value="sometimes">{t('setup.snack_sometimes', 'Thỉnh thoảng')}</option>
                <option value="often">{t('setup.snack_often', 'Thường xuyên')}</option>
              </select>
            </div>
          </div>

          <div className={`step${step === 3 ? ' active' : ''}`}>
            <h2>{t('setup.deep_title', 'Cá nhân hóa sâu')}</h2>
            <p>{t('setup.deep_desc', 'Bước cuối cùng để hoàn tất lộ trình.')}</p>
            <div className="input-group">
              <label>{t('setup.allergies', 'Dị ứng / Thực phẩm không ăn được')}</label>
              <textarea rows={2} value={form.allergies} onChange={setField('allergies')} placeholder={t('setup.allergies_ph', 'Ví dụ: Không ăn hành, dị ứng hải sản...')} />
            </div>
            <div className="input-group">
              <label>{t('setup.focus_q', 'Bạn muốn tập trung vào chất nào?')}</label>
              <select value={form.focus_macro} onChange={setField('focus_macro')}>
                <option value="balanced">{t('setup.focus_balanced', 'Cân bằng')}</option>
                <option value="high_protein">{t('setup.focus_protein', 'Nhiều Đạm (Protein)')}</option>
                <option value="low_carb">{t('setup.focus_lowcarb', 'Ít Tinh bột (Low carb)')}</option>
              </select>
            </div>
            <div className="input-group">
              <label>{t('setup.reason', 'Lý do bắt đầu?')}</label>
              <input type="text" value={form.reason} onChange={setField('reason')} placeholder={t('setup.reason_ph', 'Cải thiện sức khỏe...')} />
            </div>
          </div>

          <div className="btn-group">
            {step > 0 && (
              <button type="button" className="btn btn-prev" onClick={() => nextPrev(-1)}>
                {t('setup.prev', 'Quay lại')}
              </button>
            )}
            <button type="button" className="btn btn-next" onClick={() => nextPrev(1)} disabled={submitting}>
              {submitting ? (
                <><i className="fas fa-spinner fa-spin" /> Đang tính toán...</>
              ) : isLastStep ? (
                <><span>{t('setup.finish', 'Hoàn tất lộ trình')}</span> <i className="fa-solid fa-check" /></>
              ) : (
                <><span>{t('setup.next', 'Tiếp tục')}</span> <i className="fa-solid fa-arrow-right" /></>
              )}
            </button>
          </div>
        </form>
      </div>
    </PageShell>
  );
}

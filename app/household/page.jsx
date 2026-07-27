'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/household.css';

const GOAL_LABEL = { maintain: 'Giữ cân', lose: 'Giảm cân', gain: 'Tăng cân', muscle: 'Tăng cơ' };
const GOAL_KEY = { maintain: 'hh.goal_maintain', lose: 'hh.goal_lose', gain: 'hh.goal_gain', muscle: 'hh.goal_muscle' };
const EMPTY_MEMBER_FORM = {
  display_name: '', relation: '', birth_year: '', gender: 'male', height: '', weight: '',
  target_weight: '', goal: 'maintain', activity_level: '1.2', disease: '', allergies: '', dislikes: '', likes: '',
};

/** Initials for the pending-request avatar — there is no avatar column on profiles. */
function initialsOf(name, email) {
  const src = String(name || email || '?').trim();
  const words = src.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Stable per-person hue so each requester's avatar keeps the same color. */
function avatarHue(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return String(h);
}

export default function HouseholdPage() {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [joinRequests, setJoinRequests] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);

  const { get, post } = useApi();
  const showToast = useToast();
  const { t, tn, lang } = useTranslation();
  const router = useRouter();

  function goalLabel(goal) {
    return String(goal || '').split(',').map((g) => t(GOAL_KEY[g.trim()], GOAL_LABEL[g.trim()] || g.trim())).filter(Boolean).join(', ') || '—';
  }

  function requestedAt(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return t('hh.just_now', 'Vừa xong');
    if (mins < 60) return tn('hh.mins_ago', { n: mins }, `${mins} phút trước`);
    if (mins < 1440) return tn('hh.hours_ago', { n: Math.floor(mins / 60) }, `${Math.floor(mins / 60)} giờ trước`);
    return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN');
  }

  async function loadHousehold() {
    try {
      const data = await get('/api/family-menu', { resource: 'household' });
      setHousehold(data?.household || null);
      setMembers(data?.members || []);
      setIsOwner(!!data?.is_owner);
      setJoinRequests(data?.join_requests || []);
      setMyRequest(data?.my_pending_request || null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }
    loadHousehold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createHousehold(mode) {
    try {
      await post('/api/family-menu', { action: 'create_household', mode });
      showToast(t('hh.toast_created', 'Đã tạo hồ sơ gia đình!'), 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function switchMode() {
    const target = household.mode === 'family' ? 'chef' : 'family';
    try {
      await post('/api/family-menu', { action: 'set_household_mode', household_id: household.id, mode: target });
      showToast(t('hh.toast_mode_switched', 'Đã chuyển chế độ!'), 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function copyJoinCode() {
    try {
      await navigator.clipboard.writeText(household.join_code);
      showToast(t('hh.toast_code_copied', 'Đã sao chép mã!'), 'success');
    } catch {
      showToast(t('hh.toast_copy_failed', 'Không sao chép được — hãy chọn và copy thủ công.'), 'error');
    }
  }

  async function regenerateCode() {
    if (!window.confirm(t('hh.confirm_regenerate', 'Tạo mã mới? Mã cũ sẽ ngừng hoạt động ngay lập tức.'))) return;
    try {
      await post('/api/family-menu', { action: 'regenerate_join_code', household_id: household.id });
      showToast(t('hh.toast_code_regenerated', 'Đã tạo mã mới!'), 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function submitJoinCode() {
    const code = joinCode.trim();
    if (code.length !== 6) { showToast(t('hh.toast_need_code', 'Nhập đủ 6 chữ số.'), 'error'); return; }
    try {
      await post('/api/family-menu', { action: 'join_by_code', code });
      setJoinCode('');
      showToast(t('hh.toast_request_sent', 'Đã gửi yêu cầu — đang chờ chủ hộ duyệt.'), 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function decideRequest(requestId, accept) {
    try {
      await post('/api/family-menu', {
        action: accept ? 'approve_join_request' : 'reject_join_request',
        request_id: requestId,
      });
      showToast(
        accept ? t('hh.toast_request_accepted', 'Đã duyệt thành viên mới!') : t('hh.toast_request_rejected', 'Đã từ chối yêu cầu.'),
        'success'
      );
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function openMemberModal(memberId) {
    const m = memberId ? members.find((x) => x.id === memberId) : null;
    setEditingId(memberId || null);
    setMemberForm({
      display_name: m?.display_name || '',
      relation: m?.relation || '',
      birth_year: m?.birth_year || '',
      gender: m?.gender || 'male',
      height: m?.height || '',
      weight: m?.weight || '',
      target_weight: m?.target_weight || '',
      goal: (m?.goal || 'maintain').split(',')[0],
      activity_level: String(m?.activity_level || '1.2'),
      disease: m?.disease || '',
      allergies: (m?.allergies || []).join(', '),
      dislikes: (m?.dislikes || []).join(', '),
      likes: (m?.likes || []).join(', '),
    });
    setModalOpen(true);
  }
  function closeMemberModal() { setModalOpen(false); }

  async function saveMember() {
    const payload = { ...memberForm, display_name: memberForm.display_name.trim(), relation: memberForm.relation.trim(), disease: memberForm.disease.trim() };
    if (!payload.display_name) { showToast(t('hh.toast_need_name', 'Nhập tên thành viên.'), 'error'); return; }
    try {
      if (editingId) await post('/api/family-menu', { action: 'update_member', member_id: editingId, ...payload });
      else await post('/api/family-menu', { action: 'add_member', household_id: household.id, ...payload });
      showToast(t('hh.toast_member_saved', 'Đã lưu thành viên!'), 'success');
      closeMemberModal();
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function removeMember(memberId) {
    if (!window.confirm(t('hh.confirm_remove', 'Xóa thành viên này?'))) return;
    try {
      await post('/api/family-menu', { action: 'remove_member', member_id: memberId });
      showToast(t('hh.toast_member_removed', 'Đã xóa thành viên.'), 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
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

  const isFamily = household?.mode === 'family';

  // Same panel on the empty state and inside the family-mode card: either the
  // 6-digit input, or the "waiting for approval" notice once a request is filed.
  const joinPanel = myRequest ? (
    <div className="join-pending">
      <i className="fa-solid fa-hourglass-half" />
      <div>
        <strong>{t('hh.waiting_title', 'Đang chờ chủ hộ duyệt')}</strong>
        <p>{t('hh.waiting_desc', 'Yêu cầu của bạn đã được gửi. Bạn sẽ vào gia đình ngay khi chủ hộ chấp nhận.')}</p>
      </div>
    </div>
  ) : (
    <div className="join-row">
      <input
        className="code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => { if (e.key === 'Enter' && joinCode.length === 6) submitJoinCode(); }}
        placeholder="••••••"
        aria-label={t('hh.join_input_label', 'Mã tham gia 6 chữ số')}
      />
      <ActionButton
        className="btn btn-primary"
        onClick={submitJoinCode}
        disabled={joinCode.length !== 6}
        loadingText={t('common.sending', 'Đang gửi...')}
      >
        {t('hh.join_btn', 'Tham gia')}
      </ActionButton>
    </div>
  );

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-people-roof" /></div>
          <div>
            <h1>{t('hh.title', 'Gia đình của bạn')}</h1>
            <p>{t('hh.subtitle', 'Quản lý thành viên và chọn chế độ phù hợp — thư viện thực đơn sẽ tự điều chỉnh theo từng người')}</p>
          </div>
        </div>
      </div>

      {!household ? (
        <>
          <div className="card">
            <h3><i className="fa-solid fa-house" /> {t('hh.start', 'Bắt đầu')}</h3>
            <p style={{ color: 'var(--text-sub)', marginBottom: 18 }}>{t('hh.start_desc', 'Bạn chưa có hồ sơ gia đình. Chọn chế độ để bắt đầu:')}</p>
            <div className="mode-choice">
              <ActionButton className="mode-card" onClick={() => createHousehold('chef')}>
                <i className="fa-solid fa-kitchen-set" />
                <strong>{t('hh.mode_chef', 'Chế độ đầu bếp')}</strong>
                <span>{t('hh.mode_chef_desc', 'Bạn quản lý hồ sơ cho nhiều người (không cần họ đăng nhập) — phù hợp 1 người nấu cho cả nhà.')}</span>
              </ActionButton>
              <ActionButton className="mode-card" onClick={() => createHousehold('family')}>
                <i className="fa-solid fa-people-group" />
                <strong>{t('hh.mode_family', 'Chế độ gia đình')}</strong>
                <span>{t('hh.mode_family_desc', 'Chia sẻ mã 6 chữ số để các thành viên khác tham gia bằng tài khoản riêng của họ.')}</span>
              </ActionButton>
            </div>
          </div>

          <div className="card">
            <h3><i className="fa-solid fa-right-to-bracket" /> {t('hh.join_title_new', 'Đã có mã tham gia?')}</h3>
            <p className="join-hint">{t('hh.join_desc', 'Nhập mã 6 chữ số do chủ hộ chia sẻ.')}</p>
            {joinPanel}
          </div>
        </>
      ) : (
        <div>
          <div className="card mode-bar">
            <div>
              <h3 style={{ marginBottom: 4 }}><i className="fa-solid fa-house-user" /> <span>{isFamily ? t('hh.mode_family', 'Chế độ gia đình') : t('hh.mode_chef', 'Chế độ đầu bếp')}</span></h3>
              <p style={{ color: 'var(--text-sub)', margin: 0 }}>{isFamily ? t('hh.mode_family_note', 'Các thành viên có thể tự đăng nhập tài khoản riêng.') : t('hh.mode_chef_note', 'Bạn quản lý hồ sơ dinh dưỡng cho các thành viên (không cần họ đăng nhập).')}</p>
            </div>
            <ActionButton className="btn btn-secondary" onClick={switchMode} loadingText={t('common.processing', 'Đang xử lý...')}>{t('hh.switch_mode', 'Chuyển chế độ')}</ActionButton>
          </div>

          {isFamily && isOwner && (
            <div className="card">
              <h3><i className="fa-solid fa-hashtag" /> {t('hh.code_title', 'Mã tham gia gia đình')}</h3>
              <p className="join-hint">{t('hh.code_desc', 'Chia sẻ mã 6 chữ số này. Người nhập mã sẽ hiện ở mục "Yêu cầu tham gia" bên dưới để bạn duyệt.')}</p>
              <div className="join-code-box">
                <span className="join-code-value">{household.join_code || '——————'}</span>
                <div className="join-code-actions">
                  <button className="btn btn-secondary" onClick={copyJoinCode} disabled={!household.join_code}>
                    <i className="fa-regular fa-copy" /> {t('hh.copy', 'Sao chép')}
                  </button>
                  <ActionButton className="btn btn-secondary" onClick={regenerateCode} loadingText={t('common.processing', 'Đang xử lý...')}>
                    <i className="fa-solid fa-rotate" /> {t('hh.regenerate', 'Tạo mã mới')}
                  </ActionButton>
                </div>
              </div>
            </div>
          )}

          {isFamily && isOwner && (
            <div className="card">
              <h3>
                <i className="fa-solid fa-user-clock" /> {t('hh.requests_title', 'Yêu cầu tham gia')}
                {joinRequests.length > 0 && <span className="req-count">{joinRequests.length}</span>}
              </h3>
              {joinRequests.length === 0 ? (
                <p className="join-hint">{t('hh.requests_empty', 'Chưa có yêu cầu nào.')}</p>
              ) : (
                <div className="request-list">
                  {joinRequests.map((r) => (
                    <div className="request-card" key={r.id}>
                      <div className="req-avatar" style={{ '--req-hue': avatarHue(r.user_id) }} aria-hidden="true">
                        {initialsOf(r.display_name, r.email)}
                      </div>
                      <div className="req-info">
                        <strong>{r.display_name || t('hh.unknown_user', 'Người dùng')}</strong>
                        {r.email && <span className="req-email">{r.email}</span>}
                        <span className="req-time">{requestedAt(r.created_at)}</span>
                      </div>
                      <div className="req-actions">
                        <ActionButton className="btn btn-primary" onClick={() => decideRequest(r.id, true)} loadingText={t('common.processing', 'Đang xử lý...')}>
                          <i className="fa-solid fa-check" /> {t('hh.accept', 'Chấp nhận')}
                        </ActionButton>
                        <ActionButton className="btn btn-secondary" onClick={() => decideRequest(r.id, false)} loadingText={t('common.processing', 'Đang xử lý...')}>
                          <i className="fa-solid fa-xmark" /> {t('hh.reject', 'Từ chối')}
                        </ActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isFamily && (
            <div className="card">
              <h3><i className="fa-solid fa-right-to-bracket" /> {t('hh.join_title', 'Tham gia gia đình khác')}</h3>
              <p className="join-hint">{t('hh.join_desc', 'Nhập mã 6 chữ số do chủ hộ chia sẻ.')}</p>
              {joinPanel}
            </div>
          )}

          <div className="section-title">
            <h2>{t('hh.members', 'Thành viên')}</h2>
            <button className="btn btn-primary" onClick={() => openMemberModal(null)}><i className="fa-solid fa-plus" /> {t('hh.add_member', 'Thêm thành viên')}</button>
          </div>
          <div className="member-grid">
            {members.map((m) => {
              const isOwner = m.kind === 'linked' && m.user_id === household.owner_id;
              return (
                <div className="member-card" key={m.id}>
                  <div className="m-head">
                    <h4>{m.display_name}</h4>
                    <span className="m-tag">{m.kind === 'linked' ? t('hh.tag_linked', 'Liên kết') : t('hh.tag_dependent', 'Phụ thuộc')}{isOwner ? ` · ${t('hh.owner', 'Chủ hộ')}` : ''}</span>
                  </div>
                  <p>{m.relation ? `${m.relation} · ` : ''}{goalLabel(m.goal)}</p>
                  <p>{m.height || '?'}cm · {m.weight || '?'}kg{m.disease ? ` · ${m.disease}` : ''}</p>
                  <div className="m-chips">{(m.allergies || []).map((a, i) => <span className="m-chip" key={i}>{a}</span>)}</div>
                  <div className="m-actions">
                    <button onClick={() => openMemberModal(m.id)}><i className="fa-solid fa-pen" /> {t('hh.edit', 'Sửa')}</button>
                    {!isOwner && <ActionButton onClick={() => removeMember(m.id)} loadingText={t('common.deleting', 'Đang xóa...')}><i className="fa-solid fa-trash" /> {t('common.delete', 'Xóa')}</ActionButton>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-title">
            <h2>{t('hh.lib_title', 'Thư viện thực đơn')}</h2>
            <p><Link href="/menu-library">{t('hh.lib_link', 'Xem thư viện & tạo thực đơn cho gia đình →')}</Link></p>
          </div>
        </div>
      )}

      <div className={`member-modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="member-modal card">
          <h3><i className="fa-solid fa-user-plus" /> {editingId ? t('hh.edit_member', 'Sửa thành viên') : t('hh.add_member_title', 'Thêm thành viên')}</h3>
          <div className="form-grid">
            <label>{t('hh.f_display_name', 'Tên hiển thị')} <input type="text" value={memberForm.display_name} onChange={(e) => setMemberForm((f) => ({ ...f, display_name: e.target.value }))} /></label>
            <label>{t('hh.f_relation', 'Quan hệ')} <input type="text" value={memberForm.relation} onChange={(e) => setMemberForm((f) => ({ ...f, relation: e.target.value }))} placeholder={t('hh.f_relation_ph', 'con, bố, mẹ, ông, bà...')} /></label>
            <label>{t('hh.f_birth_year', 'Năm sinh')} <input type="number" value={memberForm.birth_year} onChange={(e) => setMemberForm((f) => ({ ...f, birth_year: e.target.value }))} /></label>
            <label>{t('hh.f_gender', 'Giới tính')}
              <select value={memberForm.gender} onChange={(e) => setMemberForm((f) => ({ ...f, gender: e.target.value }))}>
                <option value="male">{t('hh.male', 'Nam')}</option><option value="female">{t('hh.female', 'Nữ')}</option>
              </select>
            </label>
            <label>{t('hh.f_height', 'Chiều cao (cm)')} <input type="number" value={memberForm.height} onChange={(e) => setMemberForm((f) => ({ ...f, height: e.target.value }))} /></label>
            <label>{t('hh.f_weight', 'Cân nặng (kg)')} <input type="number" value={memberForm.weight} onChange={(e) => setMemberForm((f) => ({ ...f, weight: e.target.value }))} /></label>
            <label>{t('hh.f_target_weight', 'Cân nặng mục tiêu (kg)')} <input type="number" value={memberForm.target_weight} onChange={(e) => setMemberForm((f) => ({ ...f, target_weight: e.target.value }))} /></label>
            <label>{t('hh.f_goal', 'Mục tiêu')}
              <select value={memberForm.goal} onChange={(e) => setMemberForm((f) => ({ ...f, goal: e.target.value }))}>
                <option value="maintain">{t('hh.goal_maintain', 'Giữ cân')}</option><option value="lose">{t('hh.goal_lose', 'Giảm cân')}</option><option value="gain">{t('hh.goal_gain', 'Tăng cân')}</option><option value="muscle">{t('hh.goal_muscle', 'Tăng cơ')}</option>
              </select>
            </label>
            <label>{t('hh.f_activity', 'Mức vận động')}
              <select value={memberForm.activity_level} onChange={(e) => setMemberForm((f) => ({ ...f, activity_level: e.target.value }))}>
                <option value="1.2">{t('hh.act_sedentary', 'Ít vận động')}</option><option value="1.375">{t('hh.act_light', 'Vận động nhẹ')}</option><option value="1.55">{t('hh.act_moderate', 'Vận động vừa')}</option><option value="1.725">{t('hh.act_active', 'Vận động nhiều')}</option>
              </select>
            </label>
            <label>{t('hh.f_disease', 'Bệnh lý')} <input type="text" value={memberForm.disease} onChange={(e) => setMemberForm((f) => ({ ...f, disease: e.target.value }))} placeholder={t('hh.f_disease_ph', 'tiểu đường, gout, huyết áp...')} /></label>
            <label>{t('hh.f_allergies', 'Dị ứng (phân cách bởi dấu phẩy)')} <input type="text" value={memberForm.allergies} onChange={(e) => setMemberForm((f) => ({ ...f, allergies: e.target.value }))} placeholder={t('hh.f_allergies_ph', 'tôm, đậu phộng...')} /></label>
            <label>{t('hh.f_dislikes', 'Món không thích')} <input type="text" value={memberForm.dislikes} onChange={(e) => setMemberForm((f) => ({ ...f, dislikes: e.target.value }))} /></label>
            <label>{t('hh.f_likes', 'Món thích')} <input type="text" value={memberForm.likes} onChange={(e) => setMemberForm((f) => ({ ...f, likes: e.target.value }))} /></label>
          </div>
          <div className="member-modal-actions">
            <button className="btn btn-secondary" onClick={closeMemberModal}>{t('common.cancel', 'Hủy')}</button>
            <ActionButton className="btn btn-primary" onClick={saveMember} loadingText={t('common.saving', 'Đang lưu...')}>{t('hh.save_member', 'Lưu')}</ActionButton>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

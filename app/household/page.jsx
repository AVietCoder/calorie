'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import '../../styles/household.css';

const GOAL_LABEL = { maintain: 'Giữ cân', lose: 'Giảm cân', gain: 'Tăng cân', muscle: 'Tăng cơ' };
function goalLabel(goal) {
  return String(goal || '').split(',').map((g) => GOAL_LABEL[g.trim()] || g.trim()).filter(Boolean).join(', ') || '—';
}
const EMPTY_MEMBER_FORM = {
  display_name: '', relation: '', birth_year: '', gender: 'male', height: '', weight: '',
  target_weight: '', goal: 'maintain', activity_level: '1.2', disease: '', allergies: '', dislikes: '', likes: '',
};

export default function HouseholdPage() {
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteResult, setInviteResult] = useState('');
  const [acceptCode, setAcceptCode] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);

  const { get, post } = useApi();
  const showToast = useToast();
  const router = useRouter();

  async function loadHousehold() {
    try {
      const data = await get('/api/family-menu', { resource: 'household' });
      setHousehold(data?.household || null);
      setMembers(data?.members || []);
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
      showToast('Đã tạo hồ sơ gia đình!', 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function switchMode() {
    const target = household.mode === 'family' ? 'chef' : 'family';
    try {
      await post('/api/family-menu', { action: 'set_household_mode', household_id: household.id, mode: target });
      showToast('Đã chuyển chế độ!', 'success');
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function inviteMember() {
    const email = inviteEmail.trim();
    if (!email) { showToast('Nhập email trước.', 'error'); return; }
    try {
      const invite = await post('/api/family-menu', { action: 'invite_member', household_id: household.id, email });
      setInviteResult(`Mã mời: ${invite.code} — chia sẻ mã này cho ${email} để họ tham gia (mục "Tham gia gia đình khác" ở dưới).`);
      showToast('Đã tạo mã mời!', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function acceptInvite() {
    const code = acceptCode.trim();
    if (!code) { showToast('Nhập mã mời trước.', 'error'); return; }
    try {
      await post('/api/family-menu', { action: 'accept_invite', code });
      showToast('Đã tham gia gia đình!', 'success');
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
    if (!payload.display_name) { showToast('Nhập tên thành viên.', 'error'); return; }
    try {
      if (editingId) await post('/api/family-menu', { action: 'update_member', member_id: editingId, ...payload });
      else await post('/api/family-menu', { action: 'add_member', household_id: household.id, ...payload });
      showToast('Đã lưu thành viên!', 'success');
      closeMemberModal();
      await loadHousehold();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function removeMember(memberId) {
    if (!window.confirm('Xóa thành viên này?')) return;
    try {
      await post('/api/family-menu', { action: 'remove_member', member_id: memberId });
      showToast('Đã xóa thành viên.', 'success');
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

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-people-roof" /></div>
          <div>
            <h1>Gia đình của bạn</h1>
            <p>Quản lý thành viên và chọn chế độ phù hợp — thư viện thực đơn sẽ tự điều chỉnh theo từng người</p>
          </div>
        </div>
      </div>

      {!household ? (
        <div className="card">
          <h3><i className="fa-solid fa-house" /> Bắt đầu</h3>
          <p style={{ color: 'var(--text-sub)', marginBottom: 18 }}>Bạn chưa có hồ sơ gia đình. Chọn chế độ để bắt đầu:</p>
          <div className="mode-choice">
            <button className="mode-card" onClick={() => createHousehold('chef')}>
              <i className="fa-solid fa-kitchen-set" />
              <strong>Chế độ đầu bếp</strong>
              <span>Bạn quản lý hồ sơ cho nhiều người (không cần họ đăng nhập) — phù hợp 1 người nấu cho cả nhà.</span>
            </button>
            <button className="mode-card" onClick={() => createHousehold('family')}>
              <i className="fa-solid fa-people-group" />
              <strong>Chế độ gia đình</strong>
              <span>Mời các thành viên khác dùng tài khoản riêng của họ tham gia vào gia đình.</span>
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="card mode-bar">
            <div>
              <h3 style={{ marginBottom: 4 }}><i className="fa-solid fa-house-user" /> <span>{isFamily ? 'Chế độ gia đình' : 'Chế độ đầu bếp'}</span></h3>
              <p style={{ color: 'var(--text-sub)', margin: 0 }}>{isFamily ? 'Các thành viên có thể tự đăng nhập tài khoản riêng.' : 'Bạn quản lý hồ sơ dinh dưỡng cho các thành viên (không cần họ đăng nhập).'}</p>
            </div>
            <button className="btn btn-secondary" onClick={switchMode}>Chuyển chế độ</button>
          </div>

          {isFamily && (
            <div className="card">
              <h3><i className="fa-solid fa-user-plus" /> Mời thành viên</h3>
              <div className="invite-row">
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email người được mời" />
                <button className="btn btn-primary" onClick={inviteMember}>Tạo mã mời</button>
              </div>
              {inviteResult && <p style={{ color: 'var(--text-sub)', marginTop: 10 }}>{inviteResult}</p>}
              <div className="invite-row" style={{ marginTop: 14 }}>
                <input type="text" value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)} placeholder="Nhập mã mời để tham gia gia đình khác" />
                <button className="btn btn-secondary" onClick={acceptInvite}>Tham gia</button>
              </div>
            </div>
          )}

          <div className="section-title">
            <h2>Thành viên</h2>
            <button className="btn btn-primary" onClick={() => openMemberModal(null)}><i className="fa-solid fa-plus" /> Thêm thành viên</button>
          </div>
          <div className="member-grid">
            {members.map((m) => {
              const isOwner = m.kind === 'linked' && m.user_id === household.owner_id;
              return (
                <div className="member-card" key={m.id}>
                  <div className="m-head">
                    <h4>{m.display_name}</h4>
                    <span className="m-tag">{m.kind === 'linked' ? 'Liên kết' : 'Phụ thuộc'}{isOwner ? ' · Chủ hộ' : ''}</span>
                  </div>
                  <p>{m.relation ? `${m.relation} · ` : ''}{goalLabel(m.goal)}</p>
                  <p>{m.height || '?'}cm · {m.weight || '?'}kg{m.disease ? ` · ${m.disease}` : ''}</p>
                  <div className="m-chips">{(m.allergies || []).map((a, i) => <span className="m-chip" key={i}>{a}</span>)}</div>
                  <div className="m-actions">
                    <button onClick={() => openMemberModal(m.id)}><i className="fa-solid fa-pen" /> Sửa</button>
                    {!isOwner && <button onClick={() => removeMember(m.id)}><i className="fa-solid fa-trash" /> Xóa</button>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-title">
            <h2>Thư viện thực đơn</h2>
            <p><Link href="/menu-library">Xem thư viện & tạo thực đơn cho gia đình →</Link></p>
          </div>
        </div>
      )}

      <div className={`member-modal-overlay${modalOpen ? ' open' : ''}`}>
        <div className="member-modal card">
          <h3><i className="fa-solid fa-user-plus" /> {editingId ? 'Sửa thành viên' : 'Thêm thành viên'}</h3>
          <div className="form-grid">
            <label>Tên hiển thị <input type="text" value={memberForm.display_name} onChange={(e) => setMemberForm((f) => ({ ...f, display_name: e.target.value }))} /></label>
            <label>Quan hệ <input type="text" value={memberForm.relation} onChange={(e) => setMemberForm((f) => ({ ...f, relation: e.target.value }))} placeholder="con, bố, mẹ, ông, bà..." /></label>
            <label>Năm sinh <input type="number" value={memberForm.birth_year} onChange={(e) => setMemberForm((f) => ({ ...f, birth_year: e.target.value }))} /></label>
            <label>Giới tính
              <select value={memberForm.gender} onChange={(e) => setMemberForm((f) => ({ ...f, gender: e.target.value }))}>
                <option value="male">Nam</option><option value="female">Nữ</option>
              </select>
            </label>
            <label>Chiều cao (cm) <input type="number" value={memberForm.height} onChange={(e) => setMemberForm((f) => ({ ...f, height: e.target.value }))} /></label>
            <label>Cân nặng (kg) <input type="number" value={memberForm.weight} onChange={(e) => setMemberForm((f) => ({ ...f, weight: e.target.value }))} /></label>
            <label>Cân nặng mục tiêu (kg) <input type="number" value={memberForm.target_weight} onChange={(e) => setMemberForm((f) => ({ ...f, target_weight: e.target.value }))} /></label>
            <label>Mục tiêu
              <select value={memberForm.goal} onChange={(e) => setMemberForm((f) => ({ ...f, goal: e.target.value }))}>
                <option value="maintain">Giữ cân</option><option value="lose">Giảm cân</option><option value="gain">Tăng cân</option><option value="muscle">Tăng cơ</option>
              </select>
            </label>
            <label>Mức vận động
              <select value={memberForm.activity_level} onChange={(e) => setMemberForm((f) => ({ ...f, activity_level: e.target.value }))}>
                <option value="1.2">Ít vận động</option><option value="1.375">Vận động nhẹ</option><option value="1.55">Vận động vừa</option><option value="1.725">Vận động nhiều</option>
              </select>
            </label>
            <label>Bệnh lý <input type="text" value={memberForm.disease} onChange={(e) => setMemberForm((f) => ({ ...f, disease: e.target.value }))} placeholder="tiểu đường, gout, huyết áp..." /></label>
            <label>Dị ứng (phân cách bởi dấu phẩy) <input type="text" value={memberForm.allergies} onChange={(e) => setMemberForm((f) => ({ ...f, allergies: e.target.value }))} placeholder="tôm, đậu phộng..." /></label>
            <label>Món không thích <input type="text" value={memberForm.dislikes} onChange={(e) => setMemberForm((f) => ({ ...f, dislikes: e.target.value }))} /></label>
            <label>Món thích <input type="text" value={memberForm.likes} onChange={(e) => setMemberForm((f) => ({ ...f, likes: e.target.value }))} /></label>
          </div>
          <div className="member-modal-actions">
            <button className="btn btn-secondary" onClick={closeMemberModal}>Hủy</button>
            <button className="btn btn-primary" onClick={saveMember}>Lưu</button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

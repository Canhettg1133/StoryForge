import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Crown, LogIn, LogOut, Mail, ShieldCheck } from 'lucide-react';
import {
  ACCESS_FEATURES,
  ACCESS_REASONS,
} from '../../services/access/accessControl.js';
import {
  getAccessDecisionLabel,
  getFeatureDisplayName,
  getPlanDisplayName,
} from '../../services/access/accessLabels.js';
import { signOut } from '../../services/cloud/cloudAuthService.js';
import { useUserAccess } from '../../hooks/useUserAccess';
import './AccountAccessSummary.css';

function formatDate(value) {
  if (!value) return 'Không hết hạn';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không rõ';
  return date.toLocaleDateString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getAdultStatus(decision) {
  if (decision?.allowed) return 'Đã mở 18+';
  if (decision?.reason === ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED) return 'Cần xác nhận tuổi';
  if (decision?.reason === ACCESS_REASONS.ADULT_TERMS_REQUIRED) return 'Cần đồng ý điều khoản';
  if (decision?.reason === ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED) return 'Cần đồng ý lại điều khoản';
  return getAccessDecisionLabel(decision);
}

export default function AccountAccessSummary() {
  const { access, loading } = useUserAccess();
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const adultDecision = access?.features?.[ACCESS_FEATURES.ADULT_MODE];
  const enabledFeatures = Object.entries(access?.features || {})
    .filter(([, decision]) => decision.allowed)
    .map(([featureKey]) => featureKey);
  const loginReturnTo = `${location.pathname}${location.search}${location.hash}` || '/settings';
  const openLoginGuide = () => {
    navigate(`/login?returnTo=${encodeURIComponent(loginReturnTo)}`);
  };
  const handleSignOut = async () => {
    setMessage('');
    setError('');
    setSigningOut(true);
    try {
      await signOut();
      setMessage('Đã đăng xuất. Dữ liệu local vẫn được giữ trên máy này.');
    } catch (err) {
      setError(err?.message || 'Không thể đăng xuất. Hãy thử lại sau.');
    } finally {
      setSigningOut(false);
    }
  };
  const feedback = (
    <>
      {message ? (
        <div className="account-access-summary__message account-access-summary__message--success">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="account-access-summary__message account-access-summary__message--error">
          {error}
        </div>
      ) : null}
    </>
  );

  if (loading) {
    return (
      <section className="account-access-summary">
        <div className="account-access-summary__header">
          <ShieldCheck size={20} />
          <div>
            <h2>Quyền tài khoản</h2>
            <p>Đang tải gói hiện tại và các quyền đang mở.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!access?.authenticated) {
    return (
      <section className="account-access-summary">
        <div className="account-access-summary__header">
          <ShieldCheck size={20} />
          <div>
            <h2>Quyền tài khoản</h2>
            <p>Đăng nhập Google để xem gói VIP, ngày hết hạn, quyền đang mở và trạng thái 18+.</p>
          </div>
        </div>
        {feedback}
        <button type="button" className="btn btn-primary" onClick={openLoginGuide}>
          <LogIn size={15} />
          Mở trang đăng nhập
        </button>
      </section>
    );
  }

  return (
    <section className="account-access-summary">
      <div className="account-access-summary__header">
        <ShieldCheck size={20} />
        <div>
          <h2>Quyền tài khoản</h2>
          <p>Kiểm tra email, gói hiện tại, ngày hết hạn và các quyền VIP đang mở.</p>
        </div>
      </div>

      {feedback}

      <div className="account-access-summary__grid">
        <div>
          <span><Mail size={14} /> Email</span>
          <strong>{access.user?.email || 'Không rõ'}</strong>
        </div>
        <div>
          <span><Crown size={14} /> Gói hiện tại</span>
          <strong>{getPlanDisplayName(access.plan) || 'Miễn phí'}</strong>
          <small>{formatDate(access.plan?.expiresAt)}</small>
        </div>
        <div>
          <span>Trạng thái 18+</span>
          <strong>{getAdultStatus(adultDecision)}</strong>
        </div>
      </div>

      <div className="account-access-summary__features">
        {enabledFeatures.length ? (
          enabledFeatures.map((featureKey) => (
            <span key={featureKey}>{getFeatureDisplayName(featureKey)}</span>
          ))
        ) : (
          <p>Chưa có quyền VIP. Bạn có thể mở trang tài khoản, copy email và nhắn admin cấp VIP.</p>
        )}
      </div>

      <div className="account-access-summary__actions">
        {!enabledFeatures.length ? (
          <button type="button" className="btn btn-secondary" onClick={openLoginGuide}>
            Mở trang tài khoản & VIP
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary account-access-summary__logout"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut size={15} />
          {signingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
        </button>
      </div>
    </section>
  );
}

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Lock, LogIn, Settings, ShieldAlert } from 'lucide-react';
import { ACCESS_REASONS } from '../../services/access/accessControl.js';
import { useUserAccess } from '../../hooks/useUserAccess';
import './AccessGate.css';

const ADULT_CONSENT_REASONS = new Set([
  ACCESS_REASONS.AGE_CONFIRMATION_REQUIRED,
  ACCESS_REASONS.ADULT_TERMS_REQUIRED,
  ACCESS_REASONS.ADULT_TERMS_VERSION_OUTDATED,
]);

export function getAccessGateTitle(decision, fallbackTitle = 'Tính năng cần VIP') {
  const reason = decision?.reason;
  if (reason === ACCESS_REASONS.AUTH_REQUIRED) return 'Cần đăng nhập';
  if (reason === ACCESS_REASONS.FEATURE_DISABLED) return 'Tính năng đang tạm tắt';
  if (reason === ACCESS_REASONS.OVERRIDE_BLOCKED) return 'Bị chặn riêng';
  if (ADULT_CONSENT_REASONS.has(reason)) return 'Xác nhận tuổi và điều khoản 18+';
  return fallbackTitle;
}

export default function AccessGate({
  feature,
  children,
  title = 'Tính năng cần VIP',
  compact = false,
  onOpenSettings,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    access,
    getDecision,
    getDeniedMessage,
    hasFeature,
    confirmAdultTerms,
  } = useUserAccess();
  const allowed = hasFeature(feature);
  if (allowed) return children;

  const decision = getDecision(feature) || {};
  const canConfirmAdult = ADULT_CONSENT_REASONS.has(decision.reason);
  const heading = getAccessGateTitle(decision, title);
  const returnTo = `${location.pathname}${location.search}${location.hash}` || '/';
  const openLoginGuide = () => {
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  return (
    <section className={`access-gate ${compact ? 'access-gate--compact' : ''}`}>
      <div className="access-gate__icon" aria-hidden="true">
        {decision.reason === ACCESS_REASONS.OVERRIDE_BLOCKED ? <ShieldAlert size={22} /> : <Lock size={22} />}
      </div>
      <div className="access-gate__copy">
        <span className="access-gate__status">Quyền truy cập</span>
        <h2>{heading}</h2>
        <p>{getDeniedMessage(feature)}</p>
      </div>
      <div className="access-gate__actions">
        {!access?.authenticated ? (
          <button type="button" className="btn btn-primary" onClick={openLoginGuide}>
            <LogIn size={15} />
            Mở trang đăng nhập
          </button>
        ) : canConfirmAdult ? (
          <button type="button" className="btn btn-primary" onClick={() => confirmAdultTerms()}>
            Xác nhận tuổi
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={openLoginGuide}>
              <LogIn size={15} />
              Xem tài khoản & VIP
            </button>
            {onOpenSettings ? (
              <button type="button" className="btn btn-secondary" onClick={onOpenSettings}>
                <Settings size={15} />
                Mở cài đặt
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

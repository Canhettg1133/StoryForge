import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  HeartHandshake,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
} from 'lucide-react';
import {
  isCloudAuthConfigured,
  normalizeCloudReturnPath,
  signInWithGoogle,
  signOut,
} from '../../services/cloud/cloudAuthService.js';
import { ACCESS_FEATURES } from '../../services/access/accessControl.js';
import {
  getFeatureDisplayName,
  getPlanDisplayName,
} from '../../services/access/accessLabels.js';
import { SUPPORT_CONTACT } from '../../config/supportContact.js';
import SupportDonateModal from '../../components/support/SupportDonateModal.jsx';
import { useUserAccess } from '../../hooks/useUserAccess.js';
import './Login.css';

const FEATURE_ORDER = [
  ACCESS_FEATURES.TRANSLATOR_ACCESS,
  ACCESS_FEATURES.AI_CHAT_ACCESS,
  ACCESS_FEATURES.ADULT_MODE,
  ACCESS_FEATURES.AG_PROXY,
  ACCESS_FEATURES.AI_STUDIO_RELAY,
  ACCESS_FEATURES.CUSTOM_PROXY,
  ACCESS_FEATURES.TRANSLATOR_PARALLEL_HIGH,
  ACCESS_FEATURES.TRANSLATOR_BULK_KEYS,
];

function getReturnTo(location) {
  const params = new URLSearchParams(location.search || '');
  const target = normalizeCloudReturnPath(params.get('returnTo'), '/');
  return target.startsWith('/login') ? '/' : target;
}

function formatDate(value) {
  if (!value) return 'Không hết hạn';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không rõ';
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getCurrentPlanText(plan) {
  if (!plan) return 'Chưa có VIP';
  const name = getPlanDisplayName(plan) || 'Gói hiện tại';
  return plan.expiresAt ? `${name} đến ${formatDate(plan.expiresAt)}` : name;
}

function getExternalLinkProps(url) {
  if (!String(url || '').startsWith('http')) return {};
  return {
    target: '_blank',
    rel: 'noreferrer',
  };
}

export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const { access, loading } = useUserAccess();
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const returnTo = useMemo(() => getReturnTo(location), [location]);

  const email = access?.user?.email || '';
  const enabledFeatures = FEATURE_ORDER.filter((featureKey) => access?.features?.[featureKey]?.allowed);
  const hasVipPlan = ['vip', 'lifetime'].includes(String(access?.plan?.key || '').toLowerCase());
  const authenticated = Boolean(access?.authenticated);

  const handleGoogleLogin = async () => {
    setError('');
    setStatusMessage('');
    try {
      await signInWithGoogle({ returnPath: returnTo });
    } catch (err) {
      setError(err?.message || 'Không thể mở đăng nhập Google. Hãy kiểm tra cấu hình Supabase.');
    }
  };

  const handleSignOut = async () => {
    setError('');
    setStatusMessage('');
    setSigningOut(true);
    try {
      await signOut();
      setCopied(false);
      setStatusMessage('Đã đăng xuất. Dữ liệu local vẫn được giữ trên máy này.');
    } catch (err) {
      setError(err?.message || 'Không thể đăng xuất. Hãy thử lại sau.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleCopyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard?.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleGoHome = () => {
    navigate('/', { replace: true });
  };

  const handleContinue = () => {
    navigate(returnTo || '/', { replace: true });
  };

  return (
    <main className="login-page">
      <section className="login-page__shell" aria-label="Đăng nhập và kiểm tra quyền VIP">
        <div className="login-page__intro">
          <button type="button" className="login-page__back" onClick={handleGoHome}>
            <ArrowLeft size={16} />
            Về trang chủ
          </button>

          <div className="login-page__title">
            <span className="login-page__mark" aria-hidden="true">
              <Crown size={30} />
            </span>
            <div>
              <h1>Tài khoản & VIP StoryForge</h1>
              <p>Đăng nhập Google để xác nhận email. Chưa có VIP? Liên hệ admin để được cấp VIP miễn phí.</p>
            </div>
          </div>

          <div className="login-page__quick-flow" aria-label="Cách nhận VIP">
            <div>
              <LogIn size={18} />
              <strong>Đăng nhập Google</strong>
              <span>Xác nhận đúng email tài khoản.</span>
            </div>
            <div>
              <MessageCircle size={18} />
              <strong>Nhắn admin</strong>
              <span>Gửi email để admin cấp VIP miễn phí.</span>
            </div>
          </div>

          <div className="login-page__support" aria-label="Hỗ trợ và cộng đồng">
            <div>
              <h2>Hỗ trợ & cộng đồng</h2>
              <p>Ủng hộ dự án, vào server Discord hoặc nhắn admin khi cần hỗ trợ tài khoản và VIP.</p>
            </div>
            <div className="login-page__support-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDonateOpen(true)}>
                <HeartHandshake size={16} />
                Ủng hộ dự án
              </button>
              <a
                className="btn btn-secondary"
                href={SUPPORT_CONTACT.discordUrl}
                {...getExternalLinkProps(SUPPORT_CONTACT.discordUrl)}
              >
                <ExternalLink size={15} />
                Vào Discord
              </a>
              <a
                className="btn btn-secondary"
                href={SUPPORT_CONTACT.adminMessageUrl}
                {...getExternalLinkProps(SUPPORT_CONTACT.adminMessageUrl)}
              >
                <MessageCircle size={15} />
                Nhắn admin
              </a>
            </div>
          </div>
        </div>

        <div className="login-page__panel">
          {statusMessage ? (
            <div className="login-page__message login-page__message--success">
              {statusMessage}
            </div>
          ) : null}
          {error ? <div className="login-page__error">{error}</div> : null}

          {loading ? (
            <div className="login-page__status">
              <Crown size={24} />
              <h2>Đang kiểm tra tài khoản</h2>
              <p>Đang tải trạng thái đăng nhập và quyền VIP.</p>
            </div>
          ) : authenticated ? (
            <>
              <div className="login-page__status login-page__status--success">
                <CheckCircle2 size={24} />
                <h2>Đã đăng nhập</h2>
                <p>{hasVipPlan ? 'Tài khoản của bạn đã có VIP.' : 'Copy email rồi liên hệ admin cấp VIP miễn phí.'}</p>
              </div>

              <div className="login-page__account">
                <div>
                  <span><Mail size={14} /> Email tài khoản</span>
                  <strong>{email || 'Không rõ'}</strong>
                </div>
                <div>
                  <span><Crown size={14} /> Gói hiện tại</span>
                  <strong>{getCurrentPlanText(access?.plan)}</strong>
                </div>
              </div>

              {!hasVipPlan ? (
                <div className="login-page__notice">
                  <MessageCircle size={18} />
                  <p>Admin cấp VIP miễn phí theo email đăng nhập. Copy email dưới đây để gửi đúng tài khoản.</p>
                </div>
              ) : null}

              {enabledFeatures.length ? (
                <div className="login-page__feature-list" aria-label="Quyền đang có">
                  {enabledFeatures.map((featureKey) => (
                    <span key={featureKey}>{getFeatureDisplayName(featureKey)}</span>
                  ))}
                </div>
              ) : null}

              <div className={`login-page__actions ${hasVipPlan ? '' : 'login-page__actions--copy-first'}`}>
                {!hasVipPlan && email ? (
                  <button type="button" className="btn btn-primary" onClick={handleCopyEmail}>
                    <Copy size={15} />
                    {copied ? 'Đã copy email' : 'Copy email'}
                  </button>
                ) : null}
                <button type="button" className={hasVipPlan ? 'btn btn-primary' : 'btn btn-secondary'} onClick={handleContinue}>
                  Tiếp tục
                </button>
                {hasVipPlan && email ? (
                  <button type="button" className="btn btn-secondary" onClick={handleCopyEmail}>
                    <Copy size={15} />
                    {copied ? 'Đã copy email' : 'Copy email'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary login-page__logout-button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  <LogOut size={15} />
                  {signingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="login-page__status">
                <LogIn size={24} />
                <h2>Đăng nhập để kiểm tra VIP</h2>
                <p>Đăng nhập Google để lấy email gửi admin cấp VIP miễn phí.</p>
              </div>

              {!isCloudAuthConfigured() ? (
                <div className="login-page__error">
                  Supabase Auth chưa được cấu hình trong môi trường hiện tại.
                </div>
              ) : null}

              <button
                type="button"
                className="btn btn-primary login-page__login-button"
                onClick={handleGoogleLogin}
                disabled={!isCloudAuthConfigured()}
              >
                <LogIn size={17} />
                Đăng nhập bằng Google
              </button>
            </>
          )}
        </div>
      </section>

      <SupportDonateModal open={donateOpen} onClose={() => setDonateOpen(false)} />
    </main>
  );
}

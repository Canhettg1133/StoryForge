import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Copy,
  ExternalLink,
  Image,
  Key,
  Link2,
  Maximize2,
  MessageSquare,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import keyManager from '../../services/ai/keyManager';
import modelRouter, { PROVIDERS, TASK_TYPES } from '../../services/ai/router';
import { getProxyUrl } from '../../services/ai/client';
import '../Settings/Settings.css';
import './GeminiSetupGuide.css';
import './GeminiProxyGuide.css';

const PROXY_DASHBOARD_URL = 'https://ag.beijixingxing.com/dashboard';
const GOOGLE_PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
const GOOGLE_ACCOUNT_HELP_URL = 'https://support.google.com/accounts/answer/12379384';
const GUIDE_IMAGE_BASE = '/guide/gemini-proxy';

const GUIDE_IMAGE_SLOTS = {
  dashboardCli: {
    id: 'dashboard-cli',
    src: `${GUIDE_IMAGE_BASE}/01-dashboard-open-cli.png`,
    title: '\u1ea2nh 1 - T\u1eeb dashboard b\u1ea5m v\u00e0o trang CLI',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/01-dashboard-open-cli.png',
  },
  cliGetCredential: {
    id: 'cli-get-credential',
    src: `${GUIDE_IMAGE_BASE}/02-cli-get-credential.png`,
    title: '\u1ea2nh 2 - N\u00fat Get Credential trong m\u1ee5c CLI',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/02-cli-get-credential.png',
  },
  cliGoogleLogin: {
    id: 'cli-google-login',
    src: `${GUIDE_IMAGE_BASE}/03-cli-google-login.png`,
    title: '\u1ea2nh 3 - B\u01b0\u1edbc 1 Login to Google Account',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/03-cli-google-login.png',
  },
  cliCallback: {
    id: 'cli-callback',
    src: `${GUIDE_IMAGE_BASE}/04-cli-localhost-callback.jpg`,
    title: '\u1ea2nh 4 - Copy localhost link \u0111\u01b0\u1ee3c tr\u1ea3 v\u1ec1',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/04-cli-localhost-callback.jpg',
  },
  cliSubmit: {
    id: 'cli-submit',
    src: `${GUIDE_IMAGE_BASE}/05-cli-submit-callback.png`,
    title: '\u1ea2nh 5 - D\u00e1n callback URL v\u00e0o \u00f4 s\u1ed1 2 v\u00e0 b\u1ea5m submit',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/05-cli-submit-callback.png',
  },
  dashboardQuota: {
    id: 'dashboard-quota',
    src: `${GUIDE_IMAGE_BASE}/06-dashboard-model-usage.png`,
    title: '\u1ea2nh 6 - Dashboard c\u00f3 quota/l\u01b0\u1ee3t d\u00f9ng model',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/06-dashboard-model-usage.png',
  },
  keyManagement: {
    id: 'key-management',
    src: `${GUIDE_IMAGE_BASE}/07-key-management-create-keys.png`,
    title: '\u1ea2nh 7 - M\u1ee5c Key Management v\u00e0 t\u1ea1o \u0111\u00fang 3 API key',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/07-key-management-create-keys.png',
  },
  settingsProxy: {
    id: 'settings-proxy',
    src: `${GUIDE_IMAGE_BASE}/08-settings-proxy-keys.jpg`,
    title: '\u1ea2nh 8 - Ch\u1ecdn Gemini Proxy, C\u00e2n b\u1eb1ng v\u00e0 d\u00e1n 3 key v\u00e0o app',
    note: '\u0110\u1eb7t file v\u00e0o public/guide/gemini-proxy/08-settings-proxy-keys.jpg',
  },
};

function StatusCard({ icon: Icon, label, value, tone = 'neutral' }) {
  return (
    <div className={`gemini-guide-status-card is-${tone}`}>
      <div className="gemini-guide-status-card__icon">
        <Icon size={18} />
      </div>
      <div>
        <div className="gemini-guide-status-card__label">{label}</div>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StepCard({ index, title, icon: Icon, children }) {
  return (
    <section className="settings-section card animate-slide-up gemini-guide-step">
      <div className="settings-section-header">
        <div className="gemini-guide-step__badge">{index}</div>
        <Icon size={20} />
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="gemini-guide-step__content">{children}</div>
    </section>
  );
}

function GuideScreenshot({ src, title, note, onOpen }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="gemini-guide-placeholder">
        <Image size={18} />
        <strong>{title}</strong>
        <p>{note}</p>
      </div>
    );
  }

  return (
    <figure className="gemini-guide-shot">
      <div className="gemini-guide-shot__frame">
        <img
          className="gemini-guide-shot__image"
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </div>
      <div className="gemini-guide-shot__toolbar">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => onOpen({ src, title })}>
          <Maximize2 size={14} /> {'Xem r\u00f5 h\u01a1n'}
        </button>
        <a className="btn btn-ghost btn-sm" href={src} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> {'M\u1edf \u1ea3nh g\u1ed1c'}
        </a>
      </div>
      <figcaption className="gemini-guide-shot__caption">
        <strong>{title}</strong>
        <span>{note}</span>
      </figcaption>
    </figure>
  );
}

function ScreenshotGroup({ shots, onOpen }) {
  return (
    <div className={`gemini-guide-shot-grid is-${shots.length}`}>
      {shots.map((shot) => (
        <GuideScreenshot
          key={shot.id}
          src={shot.src}
          title={shot.title}
          note={shot.note}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export default function GeminiProxyGuide() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [activeShot, setActiveShot] = useState(null);

  const setupState = useMemo(() => {
    const keyCount = keyManager.getKeyCount('gemini_proxy');
    const preferredProvider = modelRouter.getPreferredProvider();
    const endpoint = getProxyUrl();
    const route = modelRouter.route(TASK_TYPES.FREE_PROMPT, {
      providerOverride: PROVIDERS.GEMINI_PROXY,
    });

    return {
      keyCount,
      preferredProvider,
      endpoint,
      route,
      usingProxy: preferredProvider === PROVIDERS.GEMINI_PROXY,
    };
  }, []);

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  const handleCopyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(setupState.endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    if (!activeShot) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveShot(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeShot]);

  return (
    <div className="settings-page gemini-guide-page gemini-proxy-guide-page">
      <header className="settings-header animate-fade-in">
        <div className="gemini-guide-back">
          <button className="btn btn-ghost btn-sm" onClick={handleGoBack}>
            <ArrowLeft size={14} /> {'Quay l\u1ea1i'}
          </button>
        </div>

        <div className="gemini-guide-hero">
          <div className="gemini-guide-hero__copy">
            <span className="gemini-guide-hero__kicker">{'H\u01b0\u1edbng d\u1eabn Gemini Proxy'}</span>
            <h1 className="settings-title">
              {'Add CLI, l\u1ea5y quota, t\u1ea1o 3 API key v\u00e0 d\u00e1n v\u00e0o StoryForge'}
            </h1>
            <p className="settings-subtitle">
              {'Guide n\u00e0y \u0111i \u0111\u00fang theo flow b\u1ea1n \u0111ang d\u00f9ng: v\u00e0o dashboard Proxy, add \u0111\u01b0\u1ee3c CLI ho\u1eb7c Antigravity, th\u1ea5y quota xu\u1ea5t hi\u1ec7n, v\u00e0o Key Management, t\u1ea1o 3 API key, r\u1ed3i quay l\u1ea1i C\u00e0i \u0111\u1eb7t c\u1ee7a StoryForge \u0111\u1ec3 d\u00e1n key.'}
            </p>
            <p className="settings-subtitle">
              {'B\u00ean d\u01b0\u1edbi ch\u1ec9 b\u1ed5 sung r\u00f5 h\u01a1n c\u00e1c \u1ea3nh v\u00e0 c\u00e1c thao t\u00e1c c\u1ee7a flow '}
              <strong>add CLI</strong>
              {', kh\u00f4ng thay \u0111\u1ed5i logic h\u01b0\u1edbng d\u1eabn c\u0169.'}
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button
              className="btn btn-primary"
              onClick={() => window.open(PROXY_DASHBOARD_URL, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={14} /> {'M\u1edf dashboard Proxy'}
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> {'M\u1edf C\u00e0i \u0111\u1eb7t'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/guide')}>
              <Sparkles size={14} /> {'Xem guide Gemini Direct'}
            </button>
          </div>
        </div>
      </header>

      <section className="settings-section card animate-slide-up gemini-guide-status">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>{'Tr\u1ea1ng th\u00e1i Proxy hi\u1ec7n t\u1ea1i'}</h2>
            <p>{'Khu n\u00e0y gi\u00fap ng\u01b0\u1eddi d\u00f9ng bi\u1ebft app \u0111\u00e3 c\u00f3 key Proxy v\u00e0 \u0111ang \u01b0u ti\u00ean Gemini Proxy hay ch\u01b0a.'}</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Proxy keys"
            value={setupState.keyCount > 0 ? `${setupState.keyCount} key` : 'Ch\u01b0a c\u00f3 key'}
            tone={setupState.keyCount >= 3 ? 'success' : setupState.keyCount > 0 ? 'warning' : 'warning'}
          />
          <StatusCard
            icon={Server}
            label={'Provider \u01b0u ti\u00ean'}
            value={setupState.usingProxy ? 'Gemini Proxy' : 'Ch\u01b0a ch\u1ecdn Gemini Proxy'}
            tone={setupState.usingProxy ? 'success' : 'neutral'}
          />
          <StatusCard
            icon={Sparkles}
            label={'Model g\u1ee3i \u00fd hi\u1ec7n t\u1ea1i'}
            value={setupState.route?.model || 'Ch\u01b0a c\u00f3'}
            tone="neutral"
          />
          <StatusCard icon={Link2} label="Proxy URL" value={setupState.endpoint} tone="neutral" />
        </div>

        <div className="gemini-guide-status-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleCopyEndpoint}>
            <Copy size={13} /> {copied ? '\u0110\u00e3 copy Proxy URL' : 'Copy Proxy URL'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            <Settings size={13} /> {'M\u1edf C\u00e0i \u0111\u1eb7t \u0111\u1ec3 d\u00e1n key'}
          </button>
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title={'\u0110\u0103ng nh\u1eadp dashboard Proxy'} icon={Server}>
          <p>
            {'M\u1edf '}
            <a className="gemini-guide-link" href={PROXY_DASHBOARD_URL} target="_blank" rel="noreferrer">
              ag.beijixingxing.com/dashboard
            </a>
            {' v\u00e0 \u0111\u0103ng nh\u1eadp t\u00e0i kho\u1ea3n. L\u00fac m\u1edbi v\u00e0o, t\u00e0i kho\u1ea3n th\u01b0\u1eddng ch\u01b0a c\u00f3 quota ngay. \u0110\u00e2y l\u00e0 b\u00ecnh th\u01b0\u1eddng.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'\u0110\u0103ng nh\u1eadp dashboard Proxy.'}</li>
            <li>{'Kh\u00f4ng t\u1ea1o API key v\u1ed9i v\u00e0ng khi quota v\u1eabn l\u00e0 0.'}</li>
            <li>{'B\u1ea1n c\u1ea7n add th\u00e0nh c\u00f4ng CLI ho\u1eb7c Antigravity tr\u01b0\u1edbc \u0111\u1ec3 dashboard nh\u1eadn l\u01b0\u1ee3t.'}</li>
            <li>
              {'N\u1ebfu \u0111ang \u0111i theo flow CLI, t\u1eeb dashboard b\u1ea5m v\u00e0o m\u1ee5c '}
              <strong>CLI</strong>
              {' nh\u01b0 \u1ea3nh b\u00ean d\u01b0\u1edbi.'}
            </li>
          </ol>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.dashboardCli} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="2" title={'V\u00e0o m\u1ee5c CLI v\u00e0 b\u1ea5m Get Credential'} icon={Sparkles}>
          <p>
            {'Flow b\u1ea1n m\u00f4 t\u1ea3 b\u1eaft \u0111\u1ea7u t\u1eeb m\u1ee5c '}
            <strong>CLI</strong>
            {'. Trong m\u1ee5c n\u00e0y, b\u1ea5m n\u00fat '}
            <strong>Get Credential</strong>
            {' r\u1ed3i ch\u1ecdn lu\u1ed3ng '}
            <strong>Obtain via Google OAuth authorization</strong>
            {'.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'M\u1edf m\u1ee5c CLI.'}</li>
            <li>{'B\u1ea5m Get Credential.'}</li>
            <li>{'Ch\u1ecdn lu\u1ed3ng l\u1ea5y credential b\u1eb1ng Google OAuth.'}</li>
          </ol>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.cliGetCredential} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="3" title={'\u0110\u0103ng nh\u1eadp \u0111\u00fang t\u00e0i kho\u1ea3n Google'} icon={Link2}>
          <p>
            {'Trong popup Get Credential, \u1edf b\u01b0\u1edbc s\u1ed1 1, b\u1ea5m v\u00e0o ph\u1ea7n \u0111\u0103ng nh\u1eadp Google. Sau khi \u0111\u0103ng nh\u1eadp xong, tr\u00ecnh duy\u1ec7t s\u1ebd hi\u1ec7n m\u1ed9t \u0111\u01b0\u1eddng link callback \u0111\u1ea7y \u0111\u1ee7.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'B\u1ea5m v\u00e0o b\u01b0\u1edbc 1. Login to Google Account.'}</li>
            <li>{'\u1ea4n authorize v\u00e0 \u0111\u0103ng nh\u1eadp \u0111\u00fang t\u00e0i kho\u1ea3n Google c\u1ea7n add.'}</li>
            <li>{'Sau khi xong, copy to\u00e0n b\u1ed9 URL \u0111ang hi\u1ec7n tr\u00ean thanh \u0111\u1ecba ch\u1ec9.'}</li>
          </ol>
          <div className="gemini-guide-note is-warning">
            <AlertTriangle size={16} />
            <span>{'H\u00e3y copy nguy\u00ean \u0111\u01b0\u1eddng link callback. Kh\u00f4ng ch\u1ec9 copy m\u1ed7i code l\u1ebb. N\u1ebfu \u0111\u0103ng nh\u1eadp sai t\u00e0i kho\u1ea3n Google, flow sau \u0111\u00f3 r\u1ea5t d\u1ec5 b\u00e1o l\u1ed7i ho\u1eb7c add sai.'}</span>
          </div>
          <ScreenshotGroup
            shots={[GUIDE_IMAGE_SLOTS.cliGoogleLogin, GUIDE_IMAGE_SLOTS.cliCallback]}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="4" title={'D\u00e1n callback URL v\u00e0 b\u1ea5m submit'} icon={Link2}>
          <p>
            {'Quay l\u1ea1i card '}
            <strong>Paste Callback URL</strong>
            {', d\u00e1n \u0111\u01b0\u1eddng link v\u1eeba copy v\u00e0o, r\u1ed3i b\u1ea5m submit. N\u1ebfu kh\u00f4ng c\u00f3 l\u1ed7i th\u00ec credential s\u1ebd \u0111\u01b0\u1ee3c add th\u00e0nh c\u00f4ng.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'Quay l\u1ea1i ph\u1ea7n Paste Callback URL.'}</li>
            <li>{'D\u00e1n nguy\u00ean \u0111\u01b0\u1eddng link callback v\u00e0o \u00f4 nh\u1eadp.'}</li>
            <li>{'B\u1ea5m Submit to Get Credential.'}</li>
            <li>{'N\u1ebfu add th\u00e0nh c\u00f4ng, quay l\u1ea1i dashboard \u0111\u1ec3 ki\u1ec3m tra quota.'}</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>{'Ch\u1ec9 c\u1ea7n add th\u00e0nh c\u00f4ng 1 trong 2 l\u00e0 CLI ho\u1eb7c Antigravity. Kh\u00f4ng b\u1eaft bu\u1ed9c ph\u1ea3i c\u00f3 c\u1ea3 hai r\u1ed3i m\u1edbi \u0111i ti\u1ebfp.'}</span>
          </div>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.cliSubmit} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="5" title={'Th\u1ea5y quota r\u1ed3i m\u1edbi v\u00e0o Key Management'} icon={ShieldCheck}>
          <p>{'Sau khi add \u0111\u01b0\u1ee3c CLI ho\u1eb7c Antigravity, quay l\u1ea1i dashboard \u0111\u1ec3 xem l\u01b0\u1ee3t d\u00f9ng model c\u1ee7a t\u00e0i kho\u1ea3n. Ch\u1ec9 khi quota \u0111\u00e3 xu\u1ea5t hi\u1ec7n, l\u00fac \u0111\u00f3 m\u1edbi sang ph\u1ea7n Key Management.'}</p>
          <ol className="gemini-guide-list">
            <li>{'Quay l\u1ea1i dashboard v\u00e0 ki\u1ec3m tra quota.'}</li>
            <li>{'N\u1ebfu quota v\u1eabn l\u00e0 0, quay l\u1ea1i ki\u1ec3m tra flow add CLI ho\u1eb7c Antigravity.'}</li>
            <li>{'Khi \u0111\u00e3 c\u00f3 quota, v\u00e0o Key Management.'}</li>
          </ol>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.dashboardQuota} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="6" title={'T\u1ea1o 3 API key'} icon={Key}>
          <p>
            {'Sau khi t\u00e0i kho\u1ea3n \u0111\u00e3 c\u00f3 quota, b\u1ea5m '}
            <strong>Create API Key</strong>
            {' v\u00e0 t\u1ea1o li\u00ean ti\u1ebfp 3 API key. \u0110\u00e2y l\u00e0 c\u00e1ch h\u1ee3p l\u00fd \u0111\u1ec3 StoryForge xoay v\u00f2ng key \u1ed5n \u0111\u1ecbnh h\u01a1n.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'Trong Key Management, b\u1ea5m Create API Key.'}</li>
            <li>{'T\u1ea1o \u0111\u1ee7 3 key.'}</li>
            <li>{'Copy t\u1eebng key ngay sau khi t\u1ea1o.'}</li>
            <li>{'Kh\u00f4ng chia s\u1ebb c\u00f4ng khai v\u00e0 n\u00ean l\u01b0u l\u1ea1i \u1edf n\u01a1i an to\u00e0n.'}</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>{'1 key \u0111\u1ee7 \u0111\u1ec3 test. Nh\u01b0ng 3 key l\u00e0 m\u1ed1c n\u00ean d\u00f9ng cho StoryForge, nh\u1ea5t l\u00e0 khi d\u00f9ng nhi\u1ec1u, \u0111\u1ec3 gi\u1ea3m nguy c\u01a1 d\u1eebng v\u00ec 1 key ch\u1ea1m ho\u1eb7c v\u01b0\u1edbng gi\u1edbi h\u1ea1n.'}</span>
          </div>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.keyManagement} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="7" title={'D\u00e1n 3 key v\u00e0o C\u00e0i \u0111\u1eb7t c\u1ee7a StoryForge'} icon={Settings}>
          <p>
            {'Quay l\u1ea1i StoryForge v\u00e0 v\u00e0o '}
            <strong>{'C\u00e0i \u0111\u1eb7t'}</strong>
            {'. N\u1ebfu b\u1ea1n \u0111ang \u1edf trong project, v\u00e0o C\u00e0i \u0111\u1eb7t c\u1ee7a project c\u0169ng \u0111\u01b0\u1ee3c, v\u00ec n\u00f3 v\u1eabn tr\u1ecf v\u1ec1 m\u00e0n h\u00ecnh c\u00e0i \u0111\u1eb7t d\u00f9ng \u0111\u1ec3 d\u00e1n key.'}
          </p>
          <ol className="gemini-guide-list">
            <li>{'M\u1edf Settings ho\u1eb7c C\u00e0i \u0111\u1eb7t trong project.'}</li>
            <li>{'T\u00ecm section API Keys.'}</li>
            <li>{'V\u00e0o khu Gemini Proxy.'}</li>
            <li>{'D\u00e1n \u0111\u1ee7 3 key, m\u1ed7i key m\u1ed9t d\u00f2ng ho\u1eb7c th\u00eam t\u1eebng key.'}</li>
            <li>{'Ch\u1ecdn provider l\u00e0 Gemini Proxy.'}</li>
            <li>{'Gi\u1eef Proxy URL m\u1eb7c \u0111\u1ecbnh /api/proxy n\u1ebfu \u0111ang d\u00f9ng proxy chu\u1ea9n c\u1ee7a app.'}</li>
            <li>{'Ch\u1ea5t l\u01b0\u1ee3ng khuy\u1ebfn ngh\u1ecb: C\u00e2n b\u1eb1ng.'}</li>
            <li>{'B\u1ea5m Test \u0111\u1ec3 ki\u1ec3m tra.'}</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> {'M\u1edf Settings'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/translator')}>
              <MessageSquare size={14} /> {'Th\u1eed D\u1ecbch truy\u1ec7n'}
            </button>
          </div>
          <GuideScreenshot {...GUIDE_IMAGE_SLOTS.settingsProxy} onOpen={setActiveShot} />
        </StepCard>

        <StepCard index="8" title={'N\u1ebfu flow add b\u1ecb l\u1ed7i'} icon={AlertTriangle}>
          <p>{'N\u1ebfu CLI ho\u1eb7c Antigravity kh\u00f4ng add \u0111\u01b0\u1ee3c, \u01b0u ti\u00ean ki\u1ec3m tra l\u1ea1i quy\u1ec1n Google tr\u01b0\u1edbc khi th\u1eed l\u1ea1i. \u0110\u00e2y l\u00e0 ph\u1ea7n \u0111\u1ec3 \u0111\u1ecdc k\u1ef9 n\u1ebfu b\u01b0\u1edbc add t\u00e0i kho\u1ea3n ho\u1eb7c submit callback b\u00e1o l\u1ed7i.'}</p>
          <ol className="gemini-guide-list">
            <li>
              {'M\u1edf '}
              <a className="gemini-guide-link" href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
                {'trang quy\u1ec1n \u1ee9ng d\u1ee5ng Google Account'}
              </a>
              {'.'}
            </li>
            <li>{'N\u1ebfu th\u1ea5y quy\u1ec1n c\u0169 c\u1ee7a Gemini CLI ho\u1eb7c Antigravity, th\u1eed g\u1ee1 b\u1ecf r\u1ed3i ch\u1ea1y l\u1ea1i flow add.'}</li>
            <li>{'Khi ch\u1ea1y l\u1ea1i, \u0111\u0103ng nh\u1eadp \u0111\u00fang t\u00e0i kho\u1ea3n Google b\u1ea1n mu\u1ed1n add v\u00e0 copy l\u1ea1i localhost link m\u1edbi.'}</li>
            <li>
              {'N\u1ebfu c\u1ea7n, m\u1edf th\u00eam '}
              <a className="gemini-guide-link" href={GOOGLE_ACCOUNT_HELP_URL} target="_blank" rel="noreferrer">
                Google Account Help
              </a>
              {'.'}
            </li>
          </ol>
        </StepCard>

        <section className="settings-section card animate-slide-up gemini-guide-faq">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>{'L\u01b0u \u00fd v\u00e0 ghi ch\u00fa quan tr\u1ecdng'}</h2>
              <p>{'Ph\u1ea7n n\u00e0y t\u1ed5ng h\u1ee3p \u0111\u00fang \u00fd b\u1ea1n v\u1eeba nh\u1edd \u0111\u1ec3 tr\u00e1nh ng\u01b0\u1eddi d\u00f9ng hi\u1ec3u nh\u1ea7m.'}</p>
            </div>
          </div>

          <div className="gemini-guide-faq-list">
            <article>
              <strong>{'C\u00f3 th\u1ec3 l\u1ea5y th\u1eb3ng \u1ea3nh t\u1eeb chat kh\u00f4ng?'}</strong>
              <p>{'Kh\u00f4ng n\u00ean. \u1ea2nh \u0111\u00ednh k\u00e8m trong chat kh\u00f4ng t\u1ef1 \u0111\u1ed9ng th\u00e0nh file trong repo. C\u00e1ch \u0111\u00fang nh\u1ea5t l\u00e0 \u0111\u1eb7t \u1ea3nh th\u1eadt v\u00e0o public/guide/gemini-proxy/ theo \u0111\u00fang t\u00ean file \u0111\u00e3 quy \u01b0\u1edbc.'}</p>
            </article>
            <article>
              <strong>{'Trang c\u00f3 t\u1ef1 c\u0103n \u1ea3nh cho \u0111\u1eb9p v\u00e0 r\u00f5 kh\u00f4ng?'}</strong>
              <p>{'C\u00f3. Khu \u1ea3nh \u0111\u00e3 d\u00f9ng img card c\u00f3 caption v\u00e0 b\u1ed1 c\u1ee5c responsive. Khi b\u1ea1n \u0111\u1eb7t \u1ea3nh g\u1ed1c \u0111\u1ee7 n\u00e9t v\u00e0o \u0111\u00fang th\u01b0 m\u1ee5c, trang s\u1ebd t\u1ef1 fit l\u1ea1i theo khung guide.'}</p>
            </article>
            <article>
              <strong>{'C\u1ea7n add c\u1ea3 CLI v\u00e0 Antigravity kh\u00f4ng?'}</strong>
              <p>{'Kh\u00f4ng b\u1eaft bu\u1ed9c. Add \u0111\u01b0\u1ee3c 1 trong 2 \u0111\u1ec3 dashboard c\u00f3 quota l\u00e0 c\u00f3 th\u1ec3 t\u1ea1o key v\u00e0 d\u00f9ng StoryForge.'}</p>
            </article>
            <article>
              <strong>{'V\u00ec sao guide nh\u1ea5n m\u1ea1nh 3 API key?'}</strong>
              <p>{'V\u00ec StoryForge s\u1ebd \u1ed5n \u0111\u1ecbnh h\u01a1n khi c\u00f3 nhi\u1ec1u key \u0111\u1ec3 xoay v\u00f2ng, nh\u1ea5t l\u00e0 v\u1edbi lu\u1ed3ng d\u1ecbch ho\u1eb7c c\u00e1c t\u00e1c v\u1ee5 g\u1ecdi AI li\u00ean t\u1ee5c.'}</p>
            </article>
          </div>
        </section>
      </div>

      {activeShot ? (
        <div className="gemini-guide-lightbox" role="dialog" aria-modal="true" onClick={() => setActiveShot(null)}>
          <div className="gemini-guide-lightbox__dialog" onClick={(event) => event.stopPropagation()}>
            <div className="gemini-guide-lightbox__header">
              <strong>{activeShot.title}</strong>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setActiveShot(null)}>
                <X size={15} /> {'\u0110\u00f3ng'}
              </button>
            </div>
            <div className="gemini-guide-lightbox__frame">
              <img className="gemini-guide-lightbox__image" src={activeShot.src} alt={activeShot.title} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
const GUIDE_IMAGE_SLOTS = [
  {
    id: 'cli-get-credential',
    src: `${GUIDE_IMAGE_BASE}/01-cli-get-credential.png`,
    title: 'Anh 1 - Nut Get Credential trong muc CLI',
    note: 'Dat file vao public/guide/gemini-proxy/01-cli-get-credential.png',
  },
  {
    id: 'cli-google-login',
    src: `${GUIDE_IMAGE_BASE}/02-cli-google-login.png`,
    title: 'Anh 2 - Buoc 1 Login to Google Account',
    note: 'Dat file vao public/guide/gemini-proxy/02-cli-google-login.png',
  },
  {
    id: 'cli-callback',
    src: `${GUIDE_IMAGE_BASE}/03-cli-callback-url.png`,
    title: 'Anh 3 - Paste Callback URL',
    note: 'Dat file vao public/guide/gemini-proxy/03-cli-callback-url.png',
  },
  {
    id: 'dashboard-quota',
    src: `${GUIDE_IMAGE_BASE}/04-dashboard-quota.png`,
    title: 'Anh 4 - Dashboard co quota/lượt dung',
    note: 'Dat file vao public/guide/gemini-proxy/04-dashboard-quota.png',
  },
  {
    id: 'key-management',
    src: `${GUIDE_IMAGE_BASE}/05-key-management.png`,
    title: 'Anh 5 - Muc Key Management',
    note: 'Dat file vao public/guide/gemini-proxy/05-key-management.png',
  },
  {
    id: 'create-api-key',
    src: `${GUIDE_IMAGE_BASE}/06-create-api-key.png`,
    title: 'Anh 6 - Nut Create API Key',
    note: 'Dat file vao public/guide/gemini-proxy/06-create-api-key.png',
  },
];

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
          <Maximize2 size={14} /> Xem ro hon
        </button>
        <a className="btn btn-ghost btn-sm" href={src} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Mo anh goc
        </a>
      </div>
      <figcaption className="gemini-guide-shot__caption">
        <strong>{title}</strong>
        <span>{note}</span>
      </figcaption>
    </figure>
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
            <ArrowLeft size={14} /> Quay lai
          </button>
        </div>

        <div className="gemini-guide-hero">
          <div className="gemini-guide-hero__copy">
            <span className="gemini-guide-hero__kicker">Huong dan Gemini Proxy</span>
            <h1 className="settings-title">Add CLI, lay quota, tao 3 API key va dan vao StoryForge</h1>
            <p className="settings-subtitle">
              Guide nay di dung theo flow ban dang dung: vao dashboard Proxy, add duoc CLI hoac Antigravity,
              thay quota xuat hien, vao Key Management, tao 3 API key, roi quay lai Cai dat cua StoryForge de dan key.
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button
              className="btn btn-primary"
              onClick={() => window.open(PROXY_DASHBOARD_URL, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={14} /> Mo dashboard Proxy
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mo Cai dat
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/guide')}>
              <Sparkles size={14} /> Xem guide Gemini Direct
            </button>
          </div>
        </div>
      </header>

      <section className="settings-section card animate-slide-up gemini-guide-status">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>Trang thai Proxy hien tai</h2>
            <p>Khu nay giup nguoi dung biet app da co key Proxy va dang uu tien Gemini Proxy hay chua.</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Proxy keys"
            value={setupState.keyCount > 0 ? `${setupState.keyCount} key` : 'Chua co key'}
            tone={setupState.keyCount >= 3 ? 'success' : setupState.keyCount > 0 ? 'warning' : 'warning'}
          />
          <StatusCard
            icon={Server}
            label="Provider uu tien"
            value={setupState.usingProxy ? 'Gemini Proxy' : 'Chua chon Gemini Proxy'}
            tone={setupState.usingProxy ? 'success' : 'neutral'}
          />
          <StatusCard
            icon={Sparkles}
            label="Model goi y hien tai"
            value={setupState.route?.model || 'Chua co'}
            tone="neutral"
          />
          <StatusCard
            icon={Link2}
            label="Proxy URL"
            value={setupState.endpoint}
            tone="neutral"
          />
        </div>

        <div className="gemini-guide-status-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleCopyEndpoint}>
            <Copy size={13} /> {copied ? 'Da copy Proxy URL' : 'Copy Proxy URL'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            <Settings size={13} /> Mo Cai dat de dan key
          </button>
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title="Dang nhap dashboard Proxy" icon={Server}>
          <p>
            Mo{' '}
            <a className="gemini-guide-link" href={PROXY_DASHBOARD_URL} target="_blank" rel="noreferrer">
              ag.beijixingxing.com/dashboard
            </a>{' '}
            va dang nhap tai khoan. Luc moi vao, tai khoan thuong chua co quota ngay. Day la binh thuong.
          </p>
          <ol className="gemini-guide-list">
            <li>Dang nhap dashboard Proxy.</li>
            <li>Khong tao API key voi vang khi quota van la 0.</li>
            <li>Ban can add thanh cong CLI hoac Antigravity truoc de dashboard nhan luot.</li>
          </ol>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[3].src}
            title={GUIDE_IMAGE_SLOTS[3].title}
            note={GUIDE_IMAGE_SLOTS[3].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="2" title="Vao muc CLI va bam Get Credential" icon={Sparkles}>
          <p>
            Flow ban mo ta bat dau tu muc <strong>CLI</strong>. Trong muc nay, bam nut <strong>Get Credential</strong>,
            sau do chon luong <strong>Obtain via Google OAuth authorization</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Mo muc <strong>CLI</strong>.</li>
            <li>Bam <strong>Get Credential</strong>.</li>
            <li>Chon luong lay credential bang Google OAuth.</li>
          </ol>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[0].src}
            title={GUIDE_IMAGE_SLOTS[0].title}
            note={GUIDE_IMAGE_SLOTS[0].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="3" title="Dang nhap dung tai khoan Google" icon={Link2}>
          <p>
            Trong popup Get Credential, o buoc so 1, bam vao phan dang nhap Google. Sau khi dang nhap xong,
            trinh duyet se hien mot duong link callback day du.
          </p>
          <ol className="gemini-guide-list">
            <li>Bam vao buoc <strong>1. Login to Google Account</strong>.</li>
            <li>An nut authorize va dang nhap dung tai khoan Google can add.</li>
            <li>Sau khi xong, copy <strong>toan bo URL</strong> dang hien tren thanh dia chi.</li>
          </ol>
          <div className="gemini-guide-note is-warning">
            <AlertTriangle size={16} />
            <span>
              Hay copy nguyen duong link callback. Khong chi copy code le. Neu dang nhap sai tai khoan Google,
              flow sau do rat de bao loi hoac add sai.
            </span>
          </div>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[1].src}
            title={GUIDE_IMAGE_SLOTS[1].title}
            note={GUIDE_IMAGE_SLOTS[1].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="4" title="Dan callback URL va bam submit" icon={Link2}>
          <p>
            Quay lai card <strong>Paste Callback URL</strong>, dan duong link vua copy vao, roi bam nut submit.
            Neu khong co loi gi thi credential se duoc add thanh cong.
          </p>
          <ol className="gemini-guide-list">
            <li>Quay lai phan <strong>2. Paste Callback URL</strong>.</li>
            <li>Dan nguyen duong link callback vao o nhap.</li>
            <li>Bam <strong>Submit to Get Credential</strong>.</li>
            <li>Neu add thanh cong, quay lai dashboard de kiem tra quota.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>
              Chi can add thanh cong <strong>1 trong 2</strong> la CLI hoac Antigravity. Khong bat buoc phai co ca hai
              roi moi di tiep.
            </span>
          </div>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[2].src}
            title={GUIDE_IMAGE_SLOTS[2].title}
            note={GUIDE_IMAGE_SLOTS[2].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="5" title="Thay quota roi moi vao Key Management" icon={ShieldCheck}>
          <p>
            Sau khi add duoc CLI hoac Antigravity, quay lai dashboard de xem luot dung model cua tai khoan.
            Chi khi quota da xuat hien, luc do moi sang phan <strong>Key Management</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Quay lai dashboard va kiem tra quota.</li>
            <li>Neu quota van la 0, quay lai kiem tra flow add CLI hoac Antigravity.</li>
            <li>Khi da co quota, vao <strong>Key Management</strong>.</li>
          </ol>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[4].src}
            title={GUIDE_IMAGE_SLOTS[4].title}
            note={GUIDE_IMAGE_SLOTS[4].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="6" title="Tao 3 API key" icon={Key}>
          <p>
            Sau khi tai khoan da co quota, bam <strong>Create API Key</strong> va tao lien tiep <strong>3 API key</strong>.
            Day la cach hop ly de StoryForge xoay vong key on dinh hon.
          </p>
          <ol className="gemini-guide-list">
            <li>Trong Key Management, bam <strong>Create API Key</strong>.</li>
            <li>Tao du <strong>3 key</strong>.</li>
            <li>Copy tung key ngay sau khi tao.</li>
            <li>Khong chia se cong khai va nen luu lai o noi an toan.</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>
              1 key du de test. Nhung 3 key la moc nen dung cho StoryForge, nhat la khi dung nhieu,
              de giam nguy co dung vi 1 key cham hoac vuong gioi han.
            </span>
          </div>
          <GuideScreenshot
            src={GUIDE_IMAGE_SLOTS[5].src}
            title={GUIDE_IMAGE_SLOTS[5].title}
            note={GUIDE_IMAGE_SLOTS[5].note}
            onOpen={setActiveShot}
          />
        </StepCard>

        <StepCard index="7" title="Dan 3 key vao Cai dat cua StoryForge" icon={Settings}>
          <p>
            Quay lai StoryForge va vao <strong>Cai dat</strong>. Neu ban dang o trong project, vao Cai dat cua project
            cung duoc, vi no van tro ve man hinh cai dat dung de dan key.
          </p>
          <ol className="gemini-guide-list">
            <li>Mo <strong>Settings</strong> hoac Cai dat trong project.</li>
            <li>Tim section <strong>API Keys</strong>.</li>
            <li>Vao khu <strong>Gemini Proxy</strong>.</li>
            <li>Dan du 3 key, moi key mot dong hoac them tung key.</li>
            <li>Chon provider la <strong>Gemini Proxy</strong>.</li>
            <li>Giu Proxy URL mac dinh <code>/api/proxy</code> neu dang dung proxy chuan cua app.</li>
            <li>Bam <strong>Test</strong> de kiem tra.</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mo Settings
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/translator')}>
              <MessageSquare size={14} /> Thu Dich truyen
            </button>
          </div>
        </StepCard>

        <StepCard index="8" title="Neu flow add bi loi" icon={AlertTriangle}>
          <p>
            Neu CLI hoac Antigravity khong add duoc, uu tien kiem tra lai quyen Google truoc khi thu lai.
          </p>
          <ol className="gemini-guide-list">
            <li>
              Mo{' '}
              <a className="gemini-guide-link" href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
                trang quyen ung dung Google Account
              </a>
              .
            </li>
            <li>Neu thay quyen cu cua Gemini CLI hoac Antigravity, thu go bo roi chay lai flow add.</li>
            <li>
              Neu can, mo them{' '}
              <a className="gemini-guide-link" href={GOOGLE_ACCOUNT_HELP_URL} target="_blank" rel="noreferrer">
                Google Account Help
              </a>
              .
            </li>
          </ol>
        </StepCard>

        <section className="settings-section card animate-slide-up gemini-guide-faq">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>Luu y va ghi chu quan trong</h2>
              <p>Phan nay tong hop dung y ban vua nho de tranh nguoi dung hieu nham.</p>
            </div>
          </div>

          <div className="gemini-guide-faq-list">
            <article>
              <strong>Co the lay thang anh tu chat khong?</strong>
              <p>Khong nen. Anh dinh kem trong chat khong tu dong thanh file trong repo. Cach dung nhat la dat anh that vao public/guide/gemini-proxy/ theo dung ten file da quy uoc.</p>
            </article>
            <article>
              <strong>Trang co tu can anh cho dep va ro khong?</strong>
              <p>Co. Khu anh da dung img card co caption va bo cuc responsive. Khi ban dat anh goc du net vao dung thu muc, trang se tu fit lai theo khung guide.</p>
            </article>
            <article>
              <strong>Can add ca CLI va Antigravity khong?</strong>
              <p>Khong bat buoc. Add duoc 1 trong 2 de dashboard co quota la co the tao key va dung StoryForge.</p>
            </article>
            <article>
              <strong>Vi sao guide nhan manh 3 API key?</strong>
              <p>Vi StoryForge se on dinh hon khi co nhieu key de xoay vong, nhat la voi luong dich hoac cac tac vu goi AI lien tuc.</p>
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
                <X size={15} /> Dong
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

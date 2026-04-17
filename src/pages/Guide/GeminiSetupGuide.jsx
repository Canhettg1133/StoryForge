import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Cloud,
  Copy,
  ExternalLink,
  Image,
  Key,
  MessageSquare,
  Settings,
  Sparkles,
  TestTube,
} from 'lucide-react';
import keyManager from '../../services/ai/keyManager';
import modelRouter, { DIRECT_MODELS, PROVIDERS } from '../../services/ai/router';
import { getGeminiDirectBaseUrl } from '../../services/ai/client';
import '../Settings/Settings.css';
import './GeminiSetupGuide.css';

const AI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';

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

function ImagePlaceholder({ title, note }) {
  return (
    <div className="gemini-guide-placeholder">
      <Image size={18} />
      <strong>{title}</strong>
      <p>{note}</p>
    </div>
  );
}

export default function GeminiSetupGuide() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const setupState = useMemo(() => {
    const keyCount = keyManager.getKeyCount('gemini_direct');
    const preferredProvider = modelRouter.getPreferredProvider();
    const activeModels = modelRouter.getActiveDirectModels();
    const endpoint = getGeminiDirectBaseUrl();

    return {
      keyCount,
      preferredProvider,
      activeModels,
      endpoint,
      usingGeminiDirect: preferredProvider === PROVIDERS.GEMINI_DIRECT,
    };
  }, []);

  const recommendedModel = DIRECT_MODELS.find((model) => model.id === 'gemini-3.1-flash-lite-preview')
    || DIRECT_MODELS[0];

  const handleOpenAiStudio = () => {
    window.open(AI_STUDIO_URL, '_blank', 'noopener,noreferrer');
  };

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

  return (
    <div className="settings-page gemini-guide-page">
      <header className="settings-header animate-fade-in">
        <div className="gemini-guide-back">
          <button className="btn btn-ghost btn-sm" onClick={handleGoBack}>
            <ArrowLeft size={14} /> Quay lại
          </button>
        </div>

        <div className="gemini-guide-hero">
          <div className="gemini-guide-hero__copy">
            <span className="gemini-guide-hero__kicker">Huong dan setup</span>
            <h1 className="settings-title">Lay API key Gemini va ket noi StoryForge</h1>
            <p className="settings-subtitle">
              Day la guide nhanh de nguoi dung moi co the lay key tu Google AI Studio,
              dan vao StoryForge, chon dung provider va bat dau chat hoac viet ngay.
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button className="btn btn-primary" onClick={handleOpenAiStudio}>
              <ExternalLink size={14} /> Mo Google AI Studio
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mo Settings
            </button>
          </div>
        </div>
      </header>

      <section className="settings-section card animate-slide-up gemini-guide-status">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>Trang thai setup hien tai</h2>
            <p>Guide nay doc theo tung buoc, nhung ban co the nhin o day de biet da setup den dau.</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Gemini Direct keys"
            value={setupState.keyCount > 0 ? `${setupState.keyCount} key` : 'Chua co key'}
            tone={setupState.keyCount > 0 ? 'success' : 'warning'}
          />
          <StatusCard
            icon={Cloud}
            label="Provider uu tien"
            value={setupState.usingGeminiDirect ? 'Gemini Direct' : 'Chua chon Gemini Direct'}
            tone={setupState.usingGeminiDirect ? 'success' : 'neutral'}
          />
          <StatusCard
            icon={Sparkles}
            label="Models dang bat"
            value={setupState.activeModels.length > 0 ? `${setupState.activeModels.length} model` : 'Chua bat model nao'}
            tone={setupState.activeModels.length > 0 ? 'success' : 'warning'}
          />
          <StatusCard
            icon={TestTube}
            label="Endpoint"
            value={setupState.endpoint}
            tone="neutral"
          />
        </div>

        <div className="gemini-guide-status-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleCopyEndpoint}>
            <Copy size={13} /> {copied ? 'Da copy endpoint' : 'Copy endpoint'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ai-chat')}>
            <MessageSquare size={13} /> Mo Chat tu do
          </button>
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title="Mo Google AI Studio va dang nhap" icon={Cloud}>
          <p>
            StoryForge dung <strong>Gemini Direct</strong> qua Google AI Studio. Day la cach de nhat cho nguoi moi vi
            khong can proxy, cung de hieu va de kiem tra loi. Ban co the mo truc tiep
            {' '}
            <a className="gemini-guide-link" href={AI_STUDIO_URL} target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            {' '}
            ngay trong buoc nay.
          </p>
          <ol className="gemini-guide-list">
            <li>
              Mo Google AI Studio bang nut o tren hoac bam truc tiep vao
              {' '}
              <a className="gemini-guide-link" href={AI_STUDIO_URL} target="_blank" rel="noreferrer">
                aistudio.google.com/app/apikey
              </a>.
            </li>
            <li>Dang nhap tai khoan Google cua ban.</li>
            <li>Neu giao dien hoi workspace hay project, chon workspace phu hop roi vao khu tao API key.</li>
          </ol>
          <ImagePlaceholder
            title="Cho anh minh hoa buoc 1"
            note="Se bo sung screenshot sau. Hien tai ban co the dua nguoi dung den dung link Google AI Studio."
          />
        </StepCard>

        <StepCard index="2" title="Tao API key Gemini" icon={Key}>
          <p>
            Trong Google AI Studio, tim khu <strong>API Keys</strong> va tao mot key moi.
            Khong can tao nhieu key ngay tu dau. Mot key la du de test.
          </p>
          <ol className="gemini-guide-list">
            <li>Bam <strong>Create API key</strong>.</li>
            <li>Neu he thong hoi project, chon project ban muon su dung.</li>
            <li>Sao chep key ngay sau khi tao.</li>
            <li>Khong chia se key cong khai va khong dan key vao noi co nguoi khac nhin thay.</li>
          </ol>
          <div className="gemini-guide-note is-warning">
            <AlertCircle size={16} />
            <span>Neu dong tab ma chua luu key, ban co the phai tao lai hoac vao lai khu API Keys de copy.</span>
          </div>
          <ImagePlaceholder
            title="Cho anh minh hoa buoc 2"
            note="Sau nay ban co the thay bang screenshot vi tri nut Create API key va man hinh copy key."
          />
        </StepCard>

        <StepCard index="3" title="Dan key vao StoryForge" icon={Settings}>
          <p>
            Quay lai StoryForge va vao <strong>Settings</strong>. O phan <strong>API Keys</strong>,
            dung dung khu <strong>Gemini Direct (AI Studio)</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Mo `Settings`.</li>
            <li>Tim section <strong>API Keys</strong>.</li>
            <li>O o nhap mot key, dan key vua copy vao.</li>
            <li>Bam <strong>Them</strong>.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>Neu ban co nhieu key, co the dung nut `Nhap nhieu` de dan moi key mot dong. Chua can lam ngay luc dau.</span>
          </div>
        </StepCard>

        <StepCard index="4" title="Chon dung provider va model" icon={Sparkles}>
          <p>
            Sau khi da co key, ban can chon <strong>Gemini Direct</strong> la provider dang dung.
            Voi nguoi moi, model de bat dau nen la <strong>{recommendedModel?.label || 'Gemini 3.1 Flash Lite Preview'}</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Trong section <strong>Provider dang dung</strong>, chon <strong>Gemini Direct</strong>.</li>
            <li>Neu can, giu nguyenn endpoint: <code>{setupState.endpoint}</code>.</li>
            <li>Trong phan models, giu bat model <strong>{recommendedModel?.label || 'Gemini 3.1 Flash Lite Preview'}</strong>.</li>
            <li>Co the giu them cac model khac, nhung khong can qua nhieu luc moi setup.</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>Model 3.1 Flash Lite thuong de bat dau hon vi quota rong hon. Hop de test chat, translation va cac thao tac nhe.</span>
          </div>
        </StepCard>

        <StepCard index="5" title="Test ket noi va thu su dung" icon={TestTube}>
          <p>
            Buoc nay dung de chac chan key hoat dong truoc khi ban vao viet truyyen hoac dich truyyen.
          </p>
          <ol className="gemini-guide-list">
            <li>Bam nut <strong>Test</strong> o khu Gemini Direct trong Settings.</li>
            <li>Neu bao ket noi OK, vao <strong>Chat tu do</strong> va gui mot cau don gian de thu.</li>
            <li>Sau do ban co the vao <strong>Dich truyen</strong> hoac mo project de bat dau viet.</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mo Settings de test
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/ai-chat')}>
              <MessageSquare size={14} /> Thu Chat tu do
            </button>
          </div>
        </StepCard>

        <section className="settings-section card animate-slide-up gemini-guide-faq">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>Loi thuong gap</h2>
              <p>Neu nguoi dung bao khong chay, day la cac truong hop nen kiem tra truoc.</p>
            </div>
          </div>

          <div className="gemini-guide-faq-list">
            <article>
              <strong>Da dan key nhung van loi</strong>
              <p>Kiem tra xem key da duoc them vao dung khu Gemini Direct chua, va provider dang chon co phai Gemini Direct khong.</p>
            </article>
            <article>
              <strong>Test ket noi loi 401/403</strong>
              <p>Thu tao key moi trong Google AI Studio. Loi nay thuong la key sai, key het quyen, hoac copy thieu ky tu.</p>
            </article>
            <article>
              <strong>Goi duoc mot luc roi dung</strong>
              <p>Day thuong la quota hoac rate limit. Thu dung model Lite, giam tan suat goi, hoac them them key de xoay vong sau.</p>
            </article>
            <article>
              <strong>Khong thay anh huong dan</strong>
              <p>Trang nay dang dung placeholder de code xong truoc. Sau nay chi can dat screenshot vao la co the noi them ngay.</p>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

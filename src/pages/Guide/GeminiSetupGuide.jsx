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

  const recommendedModel =
    DIRECT_MODELS.find((model) => model.id === 'gemini-3.1-flash-lite-preview') || DIRECT_MODELS[0];

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
            <span className="gemini-guide-hero__kicker">Hướng dẫn setup</span>
            <h1 className="settings-title">Lấy API key Gemini và kết nối StoryForge</h1>
            <p className="settings-subtitle">
              Đây là guide nhanh để người dùng mới có thể lấy key từ Google AI Studio, dán vào StoryForge,
              chọn đúng provider và bắt đầu chat hoặc viết ngay.
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button className="btn btn-primary" onClick={handleOpenAiStudio}>
              <ExternalLink size={14} /> Mở Google AI Studio
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mở Settings
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/guide/proxy')}>
              <Sparkles size={14} /> Xem guide Proxy
            </button>
          </div>
        </div>
      </header>

      <section className="settings-section card animate-slide-up gemini-guide-status">
        <div className="settings-section-header">
          <Sparkles size={20} />
          <div>
            <h2>Trạng thái setup hiện tại</h2>
            <p>Guide này đọc theo từng bước, nhưng bạn có thể nhìn ở đây để biết đã setup đến đâu.</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Gemini Direct keys"
            value={setupState.keyCount > 0 ? `${setupState.keyCount} key` : 'Chưa có key'}
            tone={setupState.keyCount > 0 ? 'success' : 'warning'}
          />
          <StatusCard
            icon={Cloud}
            label="Provider ưu tiên"
            value={setupState.usingGeminiDirect ? 'Gemini Direct' : 'Chưa chọn Gemini Direct'}
            tone={setupState.usingGeminiDirect ? 'success' : 'neutral'}
          />
          <StatusCard
            icon={Sparkles}
            label="Models đang bật"
            value={setupState.activeModels.length > 0 ? `${setupState.activeModels.length} model` : 'Chưa bật model nào'}
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
            <Copy size={13} /> {copied ? 'Đã copy endpoint' : 'Copy endpoint'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ai-chat')}>
            <MessageSquare size={13} /> Mở Chat tự do
          </button>
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title="Mở Google AI Studio và đăng nhập" icon={Cloud}>
          <p>
            StoryForge dùng <strong>Gemini Direct</strong> qua Google AI Studio. Đây là cách dễ nhất cho người mới vì
            không cần proxy, cũng dễ hiểu và dễ kiểm tra lỗi. Bạn có thể mở trực tiếp{' '}
            <a className="gemini-guide-link" href={AI_STUDIO_URL} target="_blank" rel="noreferrer">
              Google AI Studio
            </a>{' '}
            ngay trong bước này.
          </p>
          <ol className="gemini-guide-list">
            <li>
              Mở Google AI Studio bằng nút ở trên hoặc bấm trực tiếp vào{' '}
              <a className="gemini-guide-link" href={AI_STUDIO_URL} target="_blank" rel="noreferrer">
                aistudio.google.com/app/apikey
              </a>
              .
            </li>
            <li>Đăng nhập tài khoản Google của bạn.</li>
            <li>Nếu giao diện hỏi workspace hay project, chọn workspace phù hợp rồi vào khu tạo API key.</li>
          </ol>
          <ImagePlaceholder
            title="Chỗ ảnh minh họa bước 1"
            note="Sẽ bổ sung screenshot sau. Hiện tại bạn có thể đưa người dùng đến đúng link Google AI Studio."
          />
        </StepCard>

        <StepCard index="2" title="Tạo API key Gemini" icon={Key}>
          <p>
            Trong Google AI Studio, tìm khu <strong>API Keys</strong> và tạo một key mới. Không cần tạo nhiều key ngay từ
            đầu. Một key là đủ để test.
          </p>
          <ol className="gemini-guide-list">
            <li>Bấm <strong>Create API key</strong>.</li>
            <li>Nếu hệ thống hỏi project, chọn project bạn muốn sử dụng.</li>
            <li>Sao chép key ngay sau khi tạo.</li>
            <li>Không chia sẻ key công khai và không dán key vào nơi có người khác nhìn thấy.</li>
          </ol>
          <div className="gemini-guide-note is-warning">
            <AlertCircle size={16} />
            <span>Nếu đóng tab mà chưa lưu key, bạn có thể phải tạo lại hoặc vào lại khu API Keys để copy.</span>
          </div>
          <ImagePlaceholder
            title="Chỗ ảnh minh họa bước 2"
            note="Sau này bạn có thể thay bằng screenshot vị trí nút Create API key và màn hình copy key."
          />
        </StepCard>

        <StepCard index="3" title="Dán key vào StoryForge" icon={Settings}>
          <p>
            Quay lại StoryForge và vào <strong>Settings</strong>. Ở phần <strong>API Keys</strong>, dùng đúng khu{' '}
            <strong>Gemini Direct (AI Studio)</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Mở Settings.</li>
            <li>Tìm section <strong>API Keys</strong>.</li>
            <li>Ở ô nhập một key, dán key vừa copy vào.</li>
            <li>Bấm <strong>Thêm</strong>.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>Nếu bạn có nhiều key, có thể dùng nút Nhập nhiều để dán mỗi key một dòng. Chưa cần làm ngay lúc đầu.</span>
          </div>
        </StepCard>

        <StepCard index="4" title="Chọn đúng provider và model" icon={Sparkles}>
          <p>
            Sau khi đã có key, bạn cần chọn <strong>Gemini Direct</strong> là provider đang dùng. Với người mới, model để
            bắt đầu nên là <strong>{recommendedModel?.label || 'Gemini 3.1 Flash Lite Preview'}</strong>.
          </p>
          <ol className="gemini-guide-list">
            <li>Trong section <strong>Provider đang dùng</strong>, chọn <strong>Gemini Direct</strong>.</li>
            <li>Nếu cần, giữ nguyên endpoint: <code>{setupState.endpoint}</code>.</li>
            <li>
              Trong phần models, giữ bật model{' '}
              <strong>{recommendedModel?.label || 'Gemini 3.1 Flash Lite Preview'}</strong>.
            </li>
            <li>Có thể giữ thêm các model khác, nhưng không cần quá nhiều lúc mới setup.</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>Model 3.1 Flash Lite thường dễ bắt đầu hơn vì quota rộng hơn. Hợp để test chat, translation và các thao tác nhẹ.</span>
          </div>
        </StepCard>

        <StepCard index="5" title="Test kết nối và thử sử dụng" icon={TestTube}>
          <p>Bước này dùng để chắc chắn key hoạt động trước khi bạn vào viết truyện hoặc dịch truyện.</p>
          <ol className="gemini-guide-list">
            <li>Bấm nút <strong>Test</strong> ở khu Gemini Direct trong Settings.</li>
            <li>Nếu báo kết nối OK, vào <strong>Chat tự do</strong> và gửi một câu đơn giản để thử.</li>
            <li>Sau đó bạn có thể vào <strong>Dịch truyện</strong> hoặc mở project để bắt đầu viết.</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mở Settings để test
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/ai-chat')}>
              <MessageSquare size={14} /> Thử Chat tự do
            </button>
          </div>
        </StepCard>

        <section className="settings-section card animate-slide-up gemini-guide-faq">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>Lỗi thường gặp</h2>
              <p>Nếu người dùng báo không chạy, đây là các trường hợp nên kiểm tra trước.</p>
            </div>
          </div>

          <div className="gemini-guide-faq-list">
            <article>
              <strong>Đã dán key nhưng vẫn lỗi</strong>
              <p>Kiểm tra xem key đã được thêm vào đúng khu Gemini Direct chưa, và provider đang chọn có phải Gemini Direct không.</p>
            </article>
            <article>
              <strong>Test kết nối lỗi 401 hoặc 403</strong>
              <p>Thử tạo key mới trong Google AI Studio. Lỗi này thường là key sai, key hết quyền, hoặc copy thiếu ký tự.</p>
            </article>
            <article>
              <strong>Gọi được một lúc rồi dừng</strong>
              <p>Đây thường là quota hoặc rate limit. Thử dùng model Lite, giảm tần suất gọi, hoặc thêm key để xoay vòng sau.</p>
            </article>
            <article>
              <strong>Không thấy ảnh hướng dẫn</strong>
              <p>Trang này đang dùng placeholder để code xong trước. Sau này chỉ cần đặt screenshot vào là có thể nối thêm ngay.</p>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

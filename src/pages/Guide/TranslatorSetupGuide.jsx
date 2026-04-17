import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Key,
  Languages,
  MessageSquare,
  Server,
  Settings,
  Sparkles,
  Workflow,
} from 'lucide-react';
import keyManager from '../../services/ai/keyManager';
import modelRouter, { PROVIDERS } from '../../services/ai/router';
import { getGeminiDirectBaseUrl, getOllamaUrl, getProxyUrl } from '../../services/ai/client';
import '../Settings/Settings.css';
import './GeminiSetupGuide.css';

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

export default function TranslatorSetupGuide() {
  const navigate = useNavigate();

  const setupState = useMemo(() => {
    const preferredProvider = modelRouter.getPreferredProvider();
    return {
      directKeys: keyManager.getKeyCount('gemini_direct'),
      proxyKeys: keyManager.getKeyCount('gemini_proxy'),
      preferredProvider,
      directUrl: getGeminiDirectBaseUrl(),
      proxyUrl: getProxyUrl(),
      ollamaUrl: getOllamaUrl(),
      ollamaModel: localStorage.getItem('sf-ollama-model') || 'Chưa chọn',
    };
  }, []);

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/settings#gemini-guides');
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
            <span className="gemini-guide-hero__kicker">Hướng dẫn Dịch truyện</span>
            <h1 className="settings-title">Setup để dùng tính năng Dịch truyện</h1>
            <p className="settings-subtitle">
              Trang này hướng dẫn theo luồng thực tế của app: chuẩn bị key ở <strong>Settings</strong>,
              mở <strong>Dịch truyện</strong>, chọn provider và model, rồi tải file hoặc dán nội dung để chạy.
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button className="btn btn-primary" onClick={() => navigate('/translator')}>
              <Languages size={14} /> Mở Dịch truyện
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings#gemini-guides')}>
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
          <Workflow size={20} />
          <div>
            <h2>Trạng thái setup hiện tại</h2>
            <p>Đây là cấu hình AI toàn cục mà translator có thể dùng làm nguồn import ban đầu.</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Gemini Direct keys"
            value={setupState.directKeys > 0 ? `${setupState.directKeys} key` : 'Chưa có key'}
            tone={setupState.directKeys > 0 ? 'success' : 'warning'}
          />
          <StatusCard
            icon={Server}
            label="Gemini Proxy keys"
            value={setupState.proxyKeys > 0 ? `${setupState.proxyKeys} key` : 'Chưa có key'}
            tone={setupState.proxyKeys > 0 ? 'success' : 'warning'}
          />
          <StatusCard
            icon={Sparkles}
            label="Provider ưu tiên"
            value={
              setupState.preferredProvider === PROVIDERS.GEMINI_DIRECT
                ? 'Gemini Direct'
                : setupState.preferredProvider === PROVIDERS.OLLAMA
                  ? 'Ollama'
                  : 'Gemini Proxy'
            }
            tone="neutral"
          />
          <StatusCard
            icon={MessageSquare}
            label="Ollama model"
            value={setupState.ollamaModel}
            tone="neutral"
          />
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title="Chuẩn bị key ở Settings toàn cục trước" icon={Settings}>
          <p>
            Dù bạn dùng Gemini Direct hay Gemini Proxy, nên thêm key trước ở <strong>Settings</strong>.
            Đây là chỗ quản lý chính của app, dễ test kết nối và dễ kiểm tra hơn translator runtime cũ.
          </p>
          <ol className="gemini-guide-list">
            <li>Nếu dùng Gemini Direct, thêm key ở khu <strong>Gemini Direct</strong>.</li>
            <li>Nếu dùng Gemini Proxy, thêm key ở khu <strong>Gemini Proxy</strong>.</li>
            <li>Nếu dùng để dịch truyện nhiều chương, nên chuẩn bị khoảng <strong>3 key</strong> để xoay vòng ổn định hơn.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>Translator hiện đã có thể lấy cấu hình ban đầu từ Settings nếu chưa có config riêng bên trong translator.</span>
          </div>
        </StepCard>

        <StepCard index="2" title="Mở Dịch truyện và chọn provider" icon={Languages}>
          <p>
            Sau khi chuẩn bị key, mở trang <strong>Dịch truyện</strong>. Trong bảng cài đặt của translator,
            chọn một LLM chính để chạy theo nhu cầu của bạn.
          </p>
          <ol className="gemini-guide-list">
            <li><strong>Gemini Direct</strong>: dễ setup nhất nếu đã có key AI Studio.</li>
            <li><strong>Gemini Proxy</strong>: hợp khi bạn đã có key proxy và muốn xoay vòng nhiều key.</li>
            <li><strong>Ollama</strong>: dùng model local, không cần API key nhưng máy phải chạy Ollama trước.</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>Hướng đi đúng về UX là để translator chỉ còn chọn provider và model. Hiện tại app đã tiến một bước theo hướng đó bằng cơ chế import từ Settings.</span>
          </div>
        </StepCard>

        <StepCard index="3" title="Chọn model phù hợp cho dịch truyện" icon={Sparkles}>
          <p>
            Sau khi chọn provider, bước quan trọng còn lại là model. Đây là thứ ảnh hưởng trực tiếp tới tốc độ,
            chất lượng và độ ổn định khi dịch các đoạn dài.
          </p>
          <ol className="gemini-guide-list">
            <li>Với <strong>Gemini Direct</strong>, ưu tiên các model Flash hoặc Flash Lite để chạy đều hơn.</li>
            <li>Với <strong>Gemini Proxy</strong>, ưu tiên model Flash khi cần tốc độ, Pro khi cần câu chữ đẹp hơn.</li>
            <li>Với <strong>Ollama</strong>, chọn model local mà máy bạn chạy ổn định nhất trước khi tối ưu thêm.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>
              Endpoint hiện tại: Direct <code>{setupState.directUrl}</code>, Proxy <code>{setupState.proxyUrl}</code>,
              Ollama <code>{setupState.ollamaUrl}</code>.
            </span>
          </div>
        </StepCard>

        <StepCard index="4" title="Tải file hoặc dán nội dung để dịch" icon={FileText}>
          <p>
            Khi provider và model đã sẵn sàng, bạn có thể tải file truyện lên hoặc dán văn bản trực tiếp vào translator.
          </p>
          <ol className="gemini-guide-list">
            <li>Tải file thô hoặc dán nội dung vào ô nhập.</li>
            <li>Giữ thông số chunk và số luồng ở mức vừa phải khi mới test.</li>
            <li>Chạy thử với một đoạn ngắn trước, rồi mới dịch toàn chương hoặc toàn tập.</li>
          </ol>
        </StepCard>

        <StepCard index="5" title="Mẹo để dịch ổn định hơn" icon={BookOpen}>
          <ol className="gemini-guide-list">
            <li>Nếu thấy rate limit hoặc lỗi quota, giảm số luồng hoặc tăng số key.</li>
            <li>Nếu output bị cứng, đổi sang model tốt hơn trước khi chỉnh prompt quá nhiều.</li>
            <li>Nếu chỉ cần dịch nhanh, ưu tiên Flash; nếu cần câu văn đẹp hơn, thử model Pro hoặc prompt phù hợp hơn.</li>
            <li>Luôn test một đoạn ngắn trước khi thả cả file dài để tránh lãng phí lượt.</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings#gemini-guides')}>
              <Settings size={14} /> Về Settings
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/translator')}>
              <Languages size={14} /> Mở Dịch truyện
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={14} /> Mở AI Studio
            </button>
          </div>
        </StepCard>
      </div>
    </div>
  );
}

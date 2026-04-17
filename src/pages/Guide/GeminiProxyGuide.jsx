import React, { useMemo, useState } from 'react';
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
  MessageSquare,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
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
const ACTIVATE_PROJECT_URL = 'https://developers.google.com/profile/help/benefit-gemini-code-assist-standard';
const ENABLE_GEMINI_API_URL = 'https://console.cloud.google.com/marketplace/product/google/cloudaicompanion.googleapis.com';
const AUTH_SUCCESS_URL = 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini';

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

export default function GeminiProxyGuide() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="settings-page gemini-guide-page gemini-proxy-guide-page">
      <header className="settings-header animate-fade-in">
        <div className="gemini-guide-back">
          <button className="btn btn-ghost btn-sm" onClick={handleGoBack}>
            <ArrowLeft size={14} /> Quay lại
          </button>
        </div>

        <div className="gemini-guide-hero">
          <div className="gemini-guide-hero__copy">
            <span className="gemini-guide-hero__kicker">Hướng dẫn Gemini Proxy</span>
            <h1 className="settings-title">Đăng ký Proxy, kích hoạt lượt và thêm API key</h1>
            <p className="settings-subtitle">
              Trang này dành cho luồng <strong>Gemini Proxy</strong> qua BeiJiXingXing. Nó tập trung
              vào đăng ký tài khoản, kích hoạt lượt bằng CLI hoặc Antigravity, tạo nhiều API key và
              dán vào StoryForge để xoay vòng ổn định.
            </p>
          </div>
          <div className="gemini-guide-hero__actions">
            <button
              className="btn btn-primary"
              onClick={() => window.open(PROXY_DASHBOARD_URL, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink size={14} /> Mở dashboard Proxy
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mở Settings
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
            <h2>Trạng thái Proxy hiện tại</h2>
            <p>Có thể dùng khu này để biết app đã sẵn sàng chạy Gemini Proxy hay chưa.</p>
          </div>
        </div>

        <div className="gemini-guide-status-grid">
          <StatusCard
            icon={Key}
            label="Proxy keys"
            value={setupState.keyCount > 0 ? `${setupState.keyCount} key` : 'Chưa có key'}
            tone={setupState.keyCount >= 3 ? 'success' : setupState.keyCount > 0 ? 'warning' : 'warning'}
          />
          <StatusCard
            icon={Server}
            label="Provider ưu tiên"
            value={setupState.usingProxy ? 'Gemini Proxy' : 'Chưa chọn Gemini Proxy'}
            tone={setupState.usingProxy ? 'success' : 'neutral'}
          />
          <StatusCard
            icon={Sparkles}
            label="Model gợi ý hiện tại"
            value={setupState.route?.model || 'Chưa có'}
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
            <Copy size={13} /> {copied ? 'Đã copy Proxy URL' : 'Copy Proxy URL'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}>
            <Settings size={13} /> Mở Settings để dán key
          </button>
        </div>
      </section>

      <div className="settings-sections">
        <StepCard index="1" title="Đăng ký tài khoản trên dashboard Proxy" icon={Server}>
          <p>
            Mở{' '}
            <a className="gemini-guide-link" href={PROXY_DASHBOARD_URL} target="_blank" rel="noreferrer">
              ag.beijixingxing.com/dashboard
            </a>{' '}
            và đăng ký hoặc đăng nhập tài khoản. Sau khi vào dashboard, thường bạn <strong>chưa có lượt dùng ngay</strong>.
            Bạn cần làm thêm bước xác thực bằng CLI hoặc Antigravity để được cộng lượt.
          </p>
          <ol className="gemini-guide-list">
            <li>Đăng ký tài khoản trên dashboard Proxy.</li>
            <li>Đăng nhập và vào khu dashboard chính.</li>
            <li>Kiểm tra xem tài khoản đã có quota hay chưa trước khi tạo key.</li>
          </ol>
          <ImagePlaceholder
            title="Chỗ ảnh dashboard Proxy"
            note="Nên chụp màn hình dashboard sau khi đăng nhập và khu hiển thị lượt dùng hoặc API key."
          />
        </StepCard>

        <StepCard index="2" title="Kích hoạt lượt bằng CLI hoặc Antigravity" icon={Sparkles}>
          <p>
            Theo quy trình thực tế bạn cung cấp, dashboard sẽ chỉ cộng lượt sau khi tài khoản Google được add
            qua <strong>CLI</strong> hoặc <strong>Antigravity</strong>.
          </p>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>
              <strong>CLI</strong> thường được nhiều lượt hơn, nhưng tỷ lệ lỗi cũng cao hơn.
            </span>
          </div>
          <div className="gemini-guide-note">
            <ShieldCheck size={16} />
            <span>
              <strong>Antigravity</strong> thường add dễ thành công hơn. Nếu add được rồi, sau đó quay lại add CLI
              thì dễ thành công hơn nữa.
            </span>
          </div>
          <ol className="gemini-guide-list">
            <li>Nếu ưu tiên thành công, thử add Antigravity trước.</li>
            <li>Nếu muốn thêm lượt, thử add CLI sau khi Antigravity đã thành công.</li>
            <li>Với CLI, nên ưu tiên tài khoản Google lâu năm hơn. Tài khoản mới hay bị lỗi hơn.</li>
          </ol>
        </StepCard>

        <StepCard
          index="3"
          title="Nếu kích hoạt trên web không thành công"
          icon={AlertTriangle}
        >
          <p>
            Đây là nhóm link nên mở khi bấm add <strong>CLI</strong> hoặc <strong>Antigravity</strong> trên web
            mà không đi tiếp được, không cộng lượt, hoặc bị vòng lặp xác thực.
          </p>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>
              Khi mở các link bên dưới, hãy <strong>đăng nhập bằng đúng tài khoản Google bạn muốn add vào Proxy</strong>.
              Nếu trình duyệt đang dùng tài khoản khác, nên đổi đúng tài khoản trước rồi mới làm tiếp.
            </span>
          </div>
          <ol className="gemini-guide-list">
            <li>
              Mở{' '}
              <a className="gemini-guide-link" href={ACTIVATE_PROJECT_URL} target="_blank" rel="noreferrer">
                trang kích hoạt project lần đầu
              </a>{' '}
              để kiểm tra tài khoản đã link vào Google Cloud project chưa.
            </li>
            <li>
              Mở{' '}
              <a className="gemini-guide-link" href={ENABLE_GEMINI_API_URL} target="_blank" rel="noreferrer">
                trang bật Gemini for Google Cloud API
              </a>{' '}
              rồi chọn project đúng và bấm Enable nếu API chưa bật.
            </li>
            <li>
              Mở{' '}
              <a className="gemini-guide-link" href={GOOGLE_PERMISSIONS_URL} target="_blank" rel="noreferrer">
                trang quyền ứng dụng Google Account
              </a>{' '}
              để kiểm tra và thu hồi lại các quyền cũ của <strong>Gemini Code Assist and Gemini CLI</strong> hoặc{' '}
              <strong>Google Antigravity</strong>.
            </li>
            <li>
              Sau khi thu hồi quyền, quay lại dashboard Proxy và chạy lại flow add CLI hoặc add Antigravity để Google
              hiện lại màn hình cấp quyền.
            </li>
            <li>
              Khi flow thành công, bạn thường sẽ đi tới hoặc nhìn thấy nội dung tương tự trang{' '}
              <a className="gemini-guide-link" href={AUTH_SUCCESS_URL} target="_blank" rel="noreferrer">
                Authentication successful
              </a>
              .
            </li>
          </ol>
          <div className="gemini-guide-note is-warning">
            <AlertTriangle size={16} />
            <span>
              Không có một link grant công khai cố định riêng cho CLI hoặc Antigravity. Google thường chỉ hiện màn hình
              cấp quyền khi bạn khởi động lại flow từ chính CLI hoặc Antigravity sau khi đã dọn quyền cũ.
            </span>
          </div>
        </StepCard>

        <StepCard index="4" title="Add CLI: copy localhost URL rồi dán lại vào dashboard" icon={Link2}>
          <p>
            Khi add CLI, hệ thống thường đưa ra một link <strong>localhost</strong> để đăng nhập Google. Luồng bạn mô
            tả là copy link localhost đó, mở nó, đăng nhập xác thực Google, rồi quay lại dashboard Proxy để dán vào và
            hoàn tất.
          </p>
          <ol className="gemini-guide-list">
            <li>Bắt đầu bước add CLI trong dashboard.</li>
            <li>Copy link localhost mà dashboard đưa ra.</li>
            <li>Mở link localhost, đăng nhập Google, hoàn tất xác thực.</li>
            <li>Quay lại web gốc và dán hoặc hoàn tất theo hướng dẫn trên dashboard để add tài khoản thành công.</li>
          </ol>
          <div className="gemini-guide-note">
            <CheckCircle2 size={16} />
            <span>
              Nếu CLI lỗi liên tục, thử add Antigravity trước, sau đó quay lại add cùng tài khoản đó vào CLI.
            </span>
          </div>
          <ImagePlaceholder
            title="Chỗ ảnh localhost login"
            note="Nên chụp màn hình khu dashboard đưa localhost link và màn hình dán kết quả xác thực trở lại."
          />
        </StepCard>

        <StepCard index="5" title="Nếu add Antigravity lỗi, kiểm tra lại quyền Google" icon={ShieldCheck}>
          <p>
            Nếu Antigravity đăng nhập không được, hãy coi đây là bước kiểm tra nhanh trước khi thử lại.
          </p>
          <ol className="gemini-guide-list">
            <li>Vào trang quyền ứng dụng Google Account.</li>
            <li>Tìm các mục liên quan tới Antigravity hoặc Gemini CLI.</li>
            <li>Nếu thấy quyền cũ đang kẹt, thu hồi rồi quay lại dashboard để add lại.</li>
            <li>
              Nếu cần trang trợ giúp chính thức của Google, mở{' '}
              <a className="gemini-guide-link" href={GOOGLE_ACCOUNT_HELP_URL} target="_blank" rel="noreferrer">
                Google Account Help về third-party access
              </a>
              .
            </li>
          </ol>
        </StepCard>

        <StepCard index="6" title="Tạo API key trên dashboard Proxy" icon={Key}>
          <p>
            Sau khi tài khoản đã có lượt dùng, mới tạo API key. Với StoryForge, nếu bạn muốn <strong>Dịch truyện</strong>{' '}
            ổn định thì nên tạo <strong>3 API key</strong> để app xoay vòng.
          </p>
          <ol className="gemini-guide-list">
            <li>Vào khu API key trong dashboard Proxy.</li>
            <li>Tạo ít nhất 1 key để test.</li>
            <li>Nếu ưu tiên translation, tạo 3 key để StoryForge có thể luân chuyển key tốt hơn.</li>
            <li>Lưu key ở nơi an toàn và không chia sẻ công khai.</li>
          </ol>
          <div className="gemini-guide-note">
            <Sparkles size={16} />
            <span>
              3 key là mốc bắt đầu hợp lý cho luồng Dịch truyện, vì app sẽ có đủ key để xoay vòng khi một key chậm hoặc
              gặp giới hạn.
            </span>
          </div>
        </StepCard>

        <StepCard index="7" title="Dán key vào StoryForge và test" icon={Settings}>
          <p>
            Trong StoryForge, vào <strong>Settings</strong> và dán key vào khu <strong>Gemini Proxy</strong>. Chốt xong
            thì đổi provider sang Gemini Proxy và test kết nối.
          </p>
          <ol className="gemini-guide-list">
            <li>Mở Settings.</li>
            <li>Tìm section <strong>API Keys</strong> và chọn khu <strong>Gemini Proxy</strong>.</li>
            <li>Dán từng key vào, hoặc dùng nút nhập nhiều nếu bạn tạo 3 key.</li>
            <li>Trong section <strong>Provider đang dùng</strong>, chọn <strong>Gemini Proxy</strong>.</li>
            <li>Giữ Proxy URL mặc định nếu app đang dùng <code>/api/proxy</code>.</li>
            <li>Bấm <strong>Test</strong> để kiểm tra.</li>
          </ol>
          <div className="gemini-guide-action-row">
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              <Settings size={14} /> Mở Settings
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/translator')}>
              <MessageSquare size={14} /> Thử Dịch truyện
            </button>
          </div>
        </StepCard>

        <section className="settings-section card animate-slide-up gemini-guide-faq">
          <div className="settings-section-header">
            <BookOpen size={20} />
            <div>
              <h2>Lưu ý và lỗi thường gặp</h2>
              <p>Phần này tổng hợp từ thông tin bạn cung cấp và flow OAuth chính thức của Google.</p>
            </div>
          </div>

          <div className="gemini-guide-faq-list">
            <article>
              <strong>Đăng ký xong nhưng vẫn không có lượt</strong>
              <p>Đây là hành vi bình thường. Tài khoản thường phải add CLI hoặc Antigravity thành công thì dashboard mới cộng lượt.</p>
            </article>
            <article>
              <strong>CLI hay lỗi</strong>
              <p>Thử dùng tài khoản Google lâu năm hơn, hoặc add Antigravity trước rồi quay lại add CLI.</p>
            </article>
            <article>
              <strong>Antigravity không xác thực được</strong>
              <p>Thử kiểm tra trang quyền Google Account, thu hồi quyền cũ rồi chạy lại flow add trên dashboard.</p>
            </article>
            <article>
              <strong>Chỉ tạo 1 key có đủ không</strong>
              <p>Đủ để test. Nhưng nếu dùng Dịch truyện thì 3 key sẽ hợp lý hơn để app xoay vòng và giảm nguy cơ dừng vì một key.</p>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

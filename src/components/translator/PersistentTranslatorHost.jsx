import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUserAccess } from '../../hooks/useUserAccess.js';
import { getCachedAccessToken } from '../../services/access/accessClient.js';
import { normalizeTheme } from '../../config/themes.js';
import useUIStore from '../../stores/uiStore.js';
import './PersistentTranslatorHost.css';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=20';
const ADULT_TEMPLATE_LABELS = {
  adult: 'Truyện 18+',
  sacHiep: 'Sắc hiệp',
  sacHiepPro: 'Sắc hiệp Pro',
  sacHiepENI: 'Sắc hiệp ENI',
};

function getAdultTemplateLabel(templateId) {
  return ADULT_TEMPLATE_LABELS[String(templateId || '').trim()] || 'mẫu dịch 18+';
}

function isAccessSnapshot(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && !value.nativeEvent
      && (
        Object.prototype.hasOwnProperty.call(value, 'authenticated')
        || Object.prototype.hasOwnProperty.call(value, 'features')
        || Object.prototype.hasOwnProperty.call(value, 'plans')
      ),
  );
}

export default function PersistentTranslatorHost({ active = false }) {
  const frameRef = useRef(null);
  const theme = useUIStore((state) => state.theme);
  const { access, confirmAdultTerms, refreshAccess } = useUserAccess();
  const [adultConsentRequest, setAdultConsentRequest] = useState(null);
  const [adultConsentBusy, setAdultConsentBusy] = useState(false);
  const [adultConsentError, setAdultConsentError] = useState('');

  const sendAccessContext = useCallback((nextAccess = access) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || typeof window === 'undefined') return;
    const accessSnapshot = isAccessSnapshot(nextAccess) ? nextAccess : access;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ACCESS_CONTEXT',
      token: getCachedAccessToken(),
      access: accessSnapshot,
    }, window.location.origin);
  }, [access]);

  const sendThemeContext = useCallback((nextTheme = theme) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_THEME_CONTEXT',
      theme: normalizeTheme(nextTheme),
    }, window.location.origin);
  }, [theme]);

  const sendAdultConsentResult = useCallback((request, result) => {
    const frame = frameRef.current;
    if (!request?.requestId || !frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ADULT_TERMS_RESULT',
      requestId: request.requestId,
      ...result,
    }, window.location.origin);
  }, []);

  const sendAccessRefreshResult = useCallback((requestId, result) => {
    const frame = frameRef.current;
    if (!requestId || !frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ACCESS_REFRESH_RESULT',
      requestId,
      token: getCachedAccessToken(),
      ...result,
    }, window.location.origin);
  }, []);

  const closeAdultConsent = useCallback(() => {
    if (adultConsentRequest) {
      sendAdultConsentResult(adultConsentRequest, {
        ok: false,
        reason: 'USER_CANCELLED',
      });
    }
    setAdultConsentRequest(null);
    setAdultConsentBusy(false);
    setAdultConsentError('');
  }, [adultConsentRequest, sendAdultConsentResult]);

  const handleConfirmAdultTerms = useCallback(async () => {
    if (!adultConsentRequest || adultConsentBusy) return;
    setAdultConsentBusy(true);
    setAdultConsentError('');
    try {
      const snapshot = await confirmAdultTerms();
      sendAccessContext(snapshot);
      sendAdultConsentResult(adultConsentRequest, {
        ok: true,
        access: snapshot,
      });
      setAdultConsentRequest(null);
    } catch (error) {
      setAdultConsentError(error?.message || 'Không thể xác nhận điều khoản 18+. Hãy thử lại.');
    } finally {
      setAdultConsentBusy(false);
    }
  }, [adultConsentBusy, adultConsentRequest, confirmAdultTerms, sendAccessContext, sendAdultConsentResult]);

  useEffect(() => {
    sendAccessContext();
  }, [sendAccessContext]);

  useEffect(() => {
    sendThemeContext();
  }, [sendThemeContext]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const payload = event.data || {};
      if (payload.type === 'STORYFORGE_CONFIRM_ADULT_TERMS') {
        setAdultConsentRequest({
          requestId: String(payload.requestId || ''),
          templateId: String(payload.templateId || ''),
          message: String(payload.message || ''),
        });
        setAdultConsentError('');
        setAdultConsentBusy(false);
        return;
      }
      if (payload.type === 'STORYFORGE_REFRESH_ACCESS_CONTEXT') {
        const requestId = String(payload.requestId || '');
        refreshAccess({ silent: true })
          .then((snapshot) => {
            sendAccessContext(snapshot);
            sendAccessRefreshResult(requestId, {
              ok: true,
              access: snapshot,
            });
          })
          .catch((error) => {
            sendAccessRefreshResult(requestId, {
              ok: false,
              reason: error?.message || 'ACCESS_REFRESH_FAILED',
            });
          });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshAccess, sendAccessContext, sendAccessRefreshResult]);

  const adultTemplateLabel = getAdultTemplateLabel(adultConsentRequest?.templateId);

  return (
    <section
      className={`persistent-translator-host ${active ? 'is-active' : 'is-background'}`}
      aria-hidden={!active}
    >
      <iframe
        ref={frameRef}
        className="persistent-translator-host__frame"
        src={TRANSLATOR_URL}
        title="StoryForge Translator"
        onLoad={() => {
          sendAccessContext();
          sendThemeContext();
        }}
      />
      {active && adultConsentRequest ? (
        <div className="persistent-translator-host__adult-backdrop" role="presentation" onMouseDown={closeAdultConsent}>
          <section
            className="persistent-translator-host__adult-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="translator-adult-consent-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="persistent-translator-host__adult-kicker">Nội dung người lớn</span>
            <h2 id="translator-adult-consent-title">Xác nhận điều khoản 18+</h2>
            <p>
              Translator đang dùng <strong>{adultTemplateLabel}</strong>. Bạn cần xác nhận đủ 18 tuổi
              và đồng ý điều khoản 18+ trước khi tiếp tục dịch.
            </p>
            {adultConsentRequest.message ? (
              <p className="persistent-translator-host__adult-note">{adultConsentRequest.message}</p>
            ) : null}
            {adultConsentError ? (
              <div className="persistent-translator-host__adult-error" role="alert">
                {adultConsentError}
              </div>
            ) : null}
            <div className="persistent-translator-host__adult-actions">
              <button type="button" className="btn btn-ghost" onClick={closeAdultConsent} disabled={adultConsentBusy}>
                Để sau
              </button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmAdultTerms} disabled={adultConsentBusy}>
                {adultConsentBusy ? 'Đang xác nhận...' : 'Tôi đủ 18 tuổi và đồng ý'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

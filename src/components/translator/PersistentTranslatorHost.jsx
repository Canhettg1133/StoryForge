import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUserAccess } from '../../hooks/useUserAccess.js';
import { getCachedAccessToken } from '../../services/access/accessClient.js';
import { normalizeTheme } from '../../config/themes.js';
import useUIStore from '../../stores/uiStore.js';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './PersistentTranslatorHost.css';

const TRANSLATOR_URL = '/translator-runtime/index.html?v=28';
const TRANSLATOR_STATUS_STATES = new Set(['ready', 'idle', 'running', 'paused', 'completed', 'failed']);
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

function parseTranslatorStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!TRANSLATOR_STATUS_STATES.has(payload.state)) return null;
  if (!Number.isSafeInteger(payload.completed) || payload.completed < 0) return null;
  if (!Number.isSafeInteger(payload.total) || payload.total < 0) return null;
  if (payload.total > 0 && payload.completed > payload.total) return null;
  if (
    typeof payload.sessionId !== 'string'
    || payload.sessionId.length > 160
    || !/^[A-Za-z0-9._:-]*$/u.test(payload.sessionId)
  ) return null;
  return {
    state: payload.state === 'idle' ? 'ready' : payload.state,
    completed: payload.completed,
    total: payload.total,
    sessionId: payload.sessionId,
  };
}

function isSafeRequestId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160;
}

export default function PersistentTranslatorHost({ active = false, onStatusChange }) {
  const frameRef = useRef(null);
  const frameReadyRef = useRef(false);
  const theme = useUIStore((state) => state.theme);
  const { access, confirmAdultTerms, refreshAccess } = useUserAccess();
  const [adultConsentRequest, setAdultConsentRequest] = useState(null);
  const [adultConsentBusy, setAdultConsentBusy] = useState(false);
  const [adultConsentError, setAdultConsentError] = useState('');

  const publishLifecycleState = useCallback((state) => {
    onStatusChange?.({
      state,
      completed: 0,
      total: 0,
      sessionId: '',
    });
  }, [onStatusChange]);

  useEffect(() => {
    publishLifecycleState('loading');
  }, [publishLifecycleState]);

  const sendAccessContext = useCallback((nextAccess = access) => {
    const frame = frameRef.current;
    if (!frameReadyRef.current || !frame?.contentWindow || typeof window === 'undefined') return;
    const accessSnapshot = isAccessSnapshot(nextAccess) ? nextAccess : access;
    const canUseTranslator = Boolean(accessSnapshot?.features?.['translator.access']?.allowed);
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ACCESS_CONTEXT',
      token: canUseTranslator ? getCachedAccessToken() : '',
      access: accessSnapshot,
    }, window.location.origin);
  }, [access]);

  const sendThemeContext = useCallback((nextTheme = theme) => {
    const frame = frameRef.current;
    if (!frameReadyRef.current || !frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_THEME_CONTEXT',
      theme: normalizeTheme(nextTheme),
    }, window.location.origin);
  }, [theme]);

  const sendVisibilityContext = useCallback((nextActive = active) => {
    const frame = frameRef.current;
    if (!frameReadyRef.current || !frame?.contentWindow || typeof window === 'undefined') return;
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_TRANSLATOR_VISIBILITY',
      active: Boolean(nextActive),
    }, window.location.origin);
  }, [active]);

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
    const translatorAllowed = Boolean(
      result?.ok
      && result?.access?.features?.['translator.access']?.allowed,
    );
    frame.contentWindow.postMessage({
      type: 'STORYFORGE_ACCESS_REFRESH_RESULT',
      requestId,
      ...result,
      token: translatorAllowed ? getCachedAccessToken() : '',
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
    sendVisibilityContext();
  }, [sendVisibilityContext]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'STORYFORGE_TRANSLATOR_READY') {
        frameReadyRef.current = true;
        publishLifecycleState('ready');
        sendAccessContext();
        sendThemeContext();
        sendVisibilityContext();
        return;
      }
      if (payload.type === 'STORYFORGE_TRANSLATOR_STATUS') {
        const nextStatus = parseTranslatorStatus(payload);
        if (nextStatus) onStatusChange?.(nextStatus);
        return;
      }
      if (payload.type === 'STORYFORGE_CONFIRM_ADULT_TERMS') {
        const requestId = String(payload.requestId || '');
        if (!isSafeRequestId(requestId)) return;
        setAdultConsentRequest({
          requestId,
          templateId: String(payload.templateId || '').slice(0, 80),
          message: String(payload.message || '').slice(0, 1000),
        });
        setAdultConsentError('');
        setAdultConsentBusy(false);
        return;
      }
      if (payload.type === 'STORYFORGE_REFRESH_ACCESS_CONTEXT') {
        const requestId = String(payload.requestId || '');
        if (!isSafeRequestId(requestId)) return;
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
  }, [onStatusChange, publishLifecycleState, refreshAccess, sendAccessContext, sendAccessRefreshResult, sendThemeContext, sendVisibilityContext]);

  const adultTemplateLabel = getAdultTemplateLabel(adultConsentRequest?.templateId);
  const adultDialogRef = useModalAccessibility({
    open: Boolean(active && adultConsentRequest),
    onClose: closeAdultConsent,
  });

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
      />
      {active && adultConsentRequest ? (
        <div className="persistent-translator-host__adult-backdrop" role="presentation" onMouseDown={closeAdultConsent}>
          <section
            ref={adultDialogRef}
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

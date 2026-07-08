import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSession, subscribe } from '../cloud/cloudAuthService.js';
import {
  acceptAdultTerms,
  createAuthenticatedAccessFallbackSnapshot,
  createUnauthenticatedAccessSnapshot,
  fetchAccessSnapshot,
  getCachedAccessSnapshot,
  getCachedAccessToken,
  getAccessDeniedMessage,
  hasResolvedFeature,
  setCachedAccessSnapshot,
} from './accessClient.js';

const AccessContext = createContext(null);
const ACCESS_REFRESH_TTL_MS = 120 * 1000;

function getSessionUserId(session) {
  return String(session?.user?.id || '');
}

export function AccessProvider({ children }) {
  const [access, setAccess] = useState(() => setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialLoadDoneRef = useRef(false);
  const refreshCacheRef = useRef({
    token: '',
    userId: '',
    expiresAt: 0,
    snapshot: null,
  });
  const refreshInFlightRef = useRef(null);

  const refreshAccess = useCallback(async ({
    token,
    session,
    silent = false,
    force = false,
  } = {}) => {
    const effectiveSession = session || (!token ? await getSession().catch(() => null) : null);
    const accessToken = String(token || effectiveSession?.access_token || '');
    const userId = getSessionUserId(effectiveSession);
    const manualRefresh = force || (!token && !session);
    const now = Date.now();

    if (!accessToken) {
      const fallback = setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot(), '');
      refreshCacheRef.current = {
        token: '',
        userId: '',
        expiresAt: now + ACCESS_REFRESH_TTL_MS,
        snapshot: fallback,
      };
      setAccess(fallback);
      setError('');
      initialLoadDoneRef.current = true;
      setLoading(false);
      return fallback;
    }

    const cached = refreshCacheRef.current;
    if (!manualRefresh
      && cached.token === accessToken
      && cached.userId === userId
      && cached.expiresAt > now
      && cached.snapshot) {
      setAccess(cached.snapshot);
      setError('');
      initialLoadDoneRef.current = true;
      setLoading(false);
      return cached.snapshot;
    }

    const inFlight = refreshInFlightRef.current;
    if (!manualRefresh && inFlight?.token === accessToken && inFlight?.userId === userId) {
      return inFlight.promise;
    }

    const shouldShowLoading = !silent || !initialLoadDoneRef.current;
    if (shouldShowLoading) setLoading(true);
    setError('');

    const promise = (async () => {
      try {
        const snapshot = await fetchAccessSnapshot({ token: accessToken });
        refreshCacheRef.current = {
          token: accessToken,
          userId,
          expiresAt: Date.now() + ACCESS_REFRESH_TTL_MS,
          snapshot,
        };
        setAccess(snapshot);
        return snapshot;
      } catch (err) {
        const previousSnapshot = getCachedAccessSnapshot();
        const previousToken = getCachedAccessToken();
        const fallback = previousSnapshot && previousToken === accessToken
          ? previousSnapshot
          : setCachedAccessSnapshot(createAuthenticatedAccessFallbackSnapshot(effectiveSession), accessToken);
        refreshCacheRef.current = {
          token: accessToken,
          userId,
          expiresAt: Date.now() + ACCESS_REFRESH_TTL_MS,
          snapshot: fallback,
        };
        setAccess(fallback);
        setError(err?.message || 'Không thể tải quyền tài khoản.');
        return fallback;
      } finally {
        initialLoadDoneRef.current = true;
        if (shouldShowLoading) setLoading(false);
      }
    })();

    refreshInFlightRef.current = {
      token: accessToken,
      userId,
      promise,
    };

    try {
      return await promise;
    } finally {
      if (refreshInFlightRef.current?.promise === promise) {
        refreshInFlightRef.current = null;
      }
    }
  }, []);

  const confirmAdultTerms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await acceptAdultTerms({ ageConfirmed: true });
      refreshCacheRef.current = {
        token: getCachedAccessToken(),
        userId: String(snapshot?.user?.id || ''),
        expiresAt: Date.now() + ACCESS_REFRESH_TTL_MS,
        snapshot,
      };
      setAccess(snapshot);
      return snapshot;
    } catch (err) {
      setError(err?.message || 'Không thể xác nhận điều khoản 18+.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getSession()
      .then((session) => {
        if (!alive) return;
        return refreshAccess({ token: session?.access_token || '', session });
      })
      .catch(() => {
        if (!alive) return;
        const fallback = setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot(), '');
        setAccess(fallback);
        setLoading(false);
      });

    const unsubscribe = subscribe((session) => {
      refreshAccess({ token: session?.access_token || '', session, silent: true });
    });

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [refreshAccess]);

  const value = useMemo(() => ({
    access,
    loading,
    error,
    refreshAccess,
    confirmAdultTerms,
    hasFeature: (featureKey) => hasResolvedFeature(access, featureKey),
    getDecision: (featureKey) => access?.features?.[featureKey] || null,
    getDeniedMessage: (featureKey) => getAccessDeniedMessage(access?.features?.[featureKey]),
    isAdmin: Boolean(access?.admin?.allowed),
  }), [access, confirmAdultTerms, error, loading, refreshAccess]);

  return (
    <AccessContext.Provider value={value}>
      {children}
    </AccessContext.Provider>
  );
}

export function useUserAccess() {
  const value = useContext(AccessContext);
  if (value) return value;

  const fallback = createUnauthenticatedAccessSnapshot();
  return {
    access: fallback,
    loading: false,
    error: '',
    refreshAccess: async () => fallback,
    confirmAdultTerms: async () => fallback,
    hasFeature: () => false,
    getDecision: (featureKey) => fallback.features[featureKey] || null,
    getDeniedMessage: (featureKey) => getAccessDeniedMessage(fallback.features[featureKey]),
    isAdmin: false,
  };
}

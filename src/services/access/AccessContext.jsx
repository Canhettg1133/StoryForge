import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSession, subscribe } from '../cloud/cloudAuthService.js';
import {
  acceptAdultTerms,
  createUnauthenticatedAccessSnapshot,
  fetchAccessSnapshot,
  getAccessDeniedMessage,
  hasResolvedFeature,
  setCachedAccessSnapshot,
} from './accessClient.js';

const AccessContext = createContext(null);

export function AccessProvider({ children }) {
  const [access, setAccess] = useState(() => setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialLoadDoneRef = useRef(false);

  const refreshAccess = useCallback(async ({ token, silent = false } = {}) => {
    const shouldShowLoading = !silent || !initialLoadDoneRef.current;
    if (shouldShowLoading) setLoading(true);
    setError('');
    try {
      const snapshot = await fetchAccessSnapshot({ token });
      setAccess(snapshot);
      return snapshot;
    } catch (err) {
      const fallback = setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot(), '');
      setAccess(fallback);
      setError(err?.message || 'Không thể tải quyền tài khoản.');
      return fallback;
    } finally {
      initialLoadDoneRef.current = true;
      if (shouldShowLoading) setLoading(false);
    }
  }, []);

  const confirmAdultTerms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await acceptAdultTerms({ ageConfirmed: true });
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
        return refreshAccess({ token: session?.access_token || '' });
      })
      .catch(() => {
        if (!alive) return;
        const fallback = setCachedAccessSnapshot(createUnauthenticatedAccessSnapshot(), '');
        setAccess(fallback);
        setLoading(false);
      });

    const unsubscribe = subscribe((session) => {
      refreshAccess({ token: session?.access_token || '', silent: true });
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

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PRODUCT_SURFACE } from '../../config/productSurface';
import {
  consumeCloudAuthReturnPath,
  getSession,
} from '../../services/cloud/cloudAuthService.js';

export default function CloudAuthRedirectHandler() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!PRODUCT_SURFACE.enableCloudSync) return;
    if (location.pathname !== '/') return;

    const params = new URLSearchParams(location.search || '');
    if (!params.has('code')) return;

    let cancelled = false;
    getSession()
      .catch(() => null)
      .then(() => {
        if (cancelled) return;
        const targetPath = consumeCloudAuthReturnPath();
        navigate(targetPath || '/cloud-sync', { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, navigate]);

  return null;
}

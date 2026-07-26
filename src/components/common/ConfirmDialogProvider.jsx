import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './ConfirmDialogProvider.css';

const cancelWithoutProvider = async () => false;
const ConfirmDialogContext = createContext(cancelWithoutProvider);

export function useConfirmDialog() {
  return useContext(ConfirmDialogContext);
}

export function ConfirmDialogProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((accepted) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(accepted);
  }, []);

  const confirm = useCallback((options) => {
    const normalized = typeof options === 'string'
      ? { message: options }
      : (options || {});
    resolverRef.current?.(false);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest({
        title: normalized.title || 'Xác nhận thao tác',
        message: normalized.message || 'Bạn có muốn tiếp tục?',
        confirmLabel: normalized.confirmLabel || 'Tiếp tục',
        cancelLabel: normalized.cancelLabel || 'Hủy',
        danger: Boolean(normalized.danger),
      });
    });
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const dialogRef = useModalAccessibility({
    open: Boolean(request),
    onClose: () => settle(false),
  });

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {request ? (
        <div className="confirm-dialog-overlay" role="presentation" onMouseDown={() => settle(false)}>
          <section
            ref={dialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-dialog-title">{request.title}</h2>
            <p id="confirm-dialog-message">{request.message}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn-ghost" onClick={() => settle(false)}>
                {request.cancelLabel}
              </button>
              <button
                type="button"
                className={request.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => settle(true)}
              >
                {request.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </ConfirmDialogContext.Provider>
  );
}

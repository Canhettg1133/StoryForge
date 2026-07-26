import React from 'react';
import { QrCode, X } from 'lucide-react';
import { SUPPORT_CONTACT } from '../../config/supportContact.js';
import useModalAccessibility from '../../hooks/useModalAccessibility.js';
import './SupportDonateModal.css';

export default function SupportDonateModal({ open, onClose }) {
  const dialogRef = useModalAccessibility({ open, onClose });
  if (!open) return null;

  return (
    <div className="support-donate-modal__overlay" role="presentation">
      <section
        ref={dialogRef}
        className="support-donate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-donate-title"
      >
        <div className="support-donate-modal__header">
          <div>
            <h2 id="support-donate-title">Thông tin ủng hộ dự án</h2>
            <p>Quét QR hoặc chuyển khoản theo thông tin bên dưới khi bạn muốn ủng hộ StoryForge.</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Đóng thông tin ủng hộ"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="support-donate-modal__body">
          <div className="support-donate-modal__qr-frame">
            {SUPPORT_CONTACT.donate.qrImageUrl ? (
              <img src={SUPPORT_CONTACT.donate.qrImageUrl} alt="QR ủng hộ StoryForge" />
            ) : (
              <div className="support-donate-modal__qr-placeholder">
                <QrCode size={42} />
                <span>QR đang cập nhật</span>
              </div>
            )}
          </div>

          <dl className="support-donate-modal__info">
            <div>
              <dt>Ngân hàng</dt>
              <dd>{SUPPORT_CONTACT.donate.bankName}</dd>
            </div>
            <div>
              <dt>Số tài khoản</dt>
              <dd>{SUPPORT_CONTACT.donate.accountNumber}</dd>
            </div>
            <div>
              <dt>Chủ tài khoản</dt>
              <dd>{SUPPORT_CONTACT.donate.accountHolder}</dd>
            </div>
          </dl>
        </div>

        <div className="support-donate-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Quay về
          </button>
        </div>
      </section>
    </div>
  );
}

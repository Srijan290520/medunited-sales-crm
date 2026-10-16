import React from 'react';
import { AttachmentImage, AttachmentRef } from './AttachmentImage';

interface ProofModalProps {
  title: string;
  imageUrl: string;
  attachment?: AttachmentRef | null;
  onClose: () => void;
}

export const ProofModal: React.FC<ProofModalProps> = ({ title, imageUrl, attachment, onClose }) => {
  if (!imageUrl) return null;

  return (
    <>
      <div className="overlay open" onClick={onClose} style={{ zIndex: 1100 }} />
      <div className="form-popup wide open" role="dialog" aria-modal="true" aria-label={title} style={{ zIndex: 1101, maxWidth: '560px' }}>
        <div className="popup-header">
          <h3>{title}</h3>
          <button type="button" className="popup-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="popup-body" style={{ textAlign: 'center', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <AttachmentImage
            value={imageUrl}
            attachment={attachment}
            alt={title}
            style={{
              maxWidth: '100%',
              maxHeight: '70vh',
              minHeight: '120px',
              minWidth: '200px',
              objectFit: 'contain',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          />
        </div>
        <div className="popup-footer" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  );
};

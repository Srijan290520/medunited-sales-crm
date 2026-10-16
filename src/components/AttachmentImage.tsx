import React, { useEffect, useState } from 'react';
import { SaleType } from '../types';
import { api } from '../services/api';

export interface AttachmentRef {
  type: SaleType;
  saleId: string;
  kind: 'bill' | 'payment';
}

// Screenshots are private Drive files. The server only says "attached";
// the image itself is fetched through the API (which checks the viewer may
// see that record) and kept in memory only.
const cache = new Map<string, string>();

export function useAttachmentUrl(value: string, ref?: AttachmentRef | null): { src: string; loading: boolean; error: string } {
  const [src, setSrc] = useState<string>(value && value.startsWith('data:image/') ? value : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (!value) return setSrc('');
    if (value.startsWith('data:image/')) return setSrc(value);
    if (value !== 'attached' || !ref || !ref.saleId) return setSrc('');
    const key = `${ref.type}:${ref.saleId}:${ref.kind}`;
    if (cache.has(key)) return setSrc(cache.get(key)!);
    let alive = true;
    setLoading(true);
    api.getAttachment(ref.type, ref.saleId, ref.kind).then((res) => {
      if (!alive) return;
      setLoading(false);
      const url = res.attachment?.dataUrl;
      if (res.error || typeof url !== 'string' || !url.startsWith('data:image/')) {
        setError(res.message || 'Could not load image');
        setSrc('');
        return;
      }
      if (cache.size > 30) cache.clear();
      cache.set(key, url);
      setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [value, ref?.type, ref?.saleId, ref?.kind]);

  return { src, loading, error };
}

interface AttachmentImageProps {
  value: string;
  attachment?: AttachmentRef | null;
  alt: string;
  style?: React.CSSProperties;
  className?: string;
}

export const AttachmentImage: React.FC<AttachmentImageProps> = ({ value, attachment, alt, style, className }) => {
  const { src, loading, error } = useAttachmentUrl(value, attachment);
  if (loading) return <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Loading…</div>;
  if (error || !src) return <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{error || 'No image'}</div>;
  return <img src={src} alt={alt} style={style} className={className} />;
};

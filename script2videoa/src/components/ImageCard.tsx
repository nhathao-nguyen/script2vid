import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Image as ImageIcon, Video } from 'lucide-react';
import { motion } from 'motion/react';
import { MediaAsset, ScriptSegment } from '../types';
import { downloadMediaBlob } from '../lib/mediaApi';
import { isAssetExportable } from '../lib/licenseGate';

interface ImageCardProps {
  segment: ScriptSegment;
  asset: MediaAsset;
  isSelected: boolean;
  onSelect: () => void;
  onToggleManualReview: (isManuallyVerified: boolean) => void;
}

const statusClass = {
  approved: 'bg-emerald-500/90 text-white border-emerald-300/30',
  attribution_required: 'bg-sky-500/90 text-white border-sky-300/30',
  review_required: 'bg-amber-500/90 text-black border-amber-200/40',
  rejected: 'bg-red-500/90 text-white border-red-300/30',
};

const statusLabel = {
  approved: 'Approved',
  attribution_required: 'Attribution',
  review_required: 'Review',
  rejected: 'Rejected',
};

const cleanFilePart = (value: string) => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60) || 'asset';

const extensionFromContentType = (contentType: string | null, fallback: string) => {
  if (!contentType) return fallback;
  if (contentType.includes('video/mp4')) return 'mp4';
  if (contentType.includes('video/webm')) return 'webm';
  if (contentType.includes('image/webp')) return 'webp';
  if (contentType.includes('image/png')) return 'png';
  if (contentType.includes('image/jpeg')) return 'jpg';
  if (contentType.includes('image/gif')) return 'gif';
  return fallback;
};

const ImageCard: React.FC<ImageCardProps> = ({ segment, asset, isSelected, onSelect, onToggleManualReview }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const videoUrl = asset.videoFiles?.find(f => f.quality === 'sd')?.link || asset.videoFiles?.[0]?.link || asset.downloadUrl;
  const canDownload = isAssetExportable(asset);

  const downloadAsset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDownload) return;

    try {
      const res = await downloadMediaBlob(asset);
      const blob = await res.blob();
      const extension = extensionFromContentType(res.headers.get('Content-Type'), segment.media_type === 'video' ? 'mp4' : 'jpg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanFilePart(asset.provider)}_${cleanFilePart(asset.title)}_${cleanFilePart(asset.id)}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed', err);
      window.open(asset.downloadUrl, '_blank');
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
      className={`relative aspect-video rounded-xl overflow-hidden group border-2 transition-all duration-300 ${
        asset.licenseStatus === 'rejected' ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
      } ${
        isSelected
          ? 'border-brand ring-4 ring-brand/10 shadow-[0_0_30px_rgba(0,71,171,0.3)] scale-[1.02]'
          : 'border-white/5 hover:border-white/20 hover:shadow-2xl'
      } bg-[var(--color-bg-card)]`}
    >
      {!previewFailed && asset.previewUrl ? (
        <img
          src={asset.previewUrl}
          alt={asset.title}
          onError={() => setPreviewFailed(true)}
          className={`w-full h-full object-cover ${
            isHovered ? 'brightness-110' : 'brightness-100'
          } ${isSelected ? 'brightness-110' : ''}`}
        />
      ) : (
        <div className="w-full h-full bg-[#161b20] flex flex-col items-center justify-center gap-3 p-6 text-center">
          {asset.mediaType === 'video' ? <Video className="text-zinc-500" size={28} /> : <ImageIcon className="text-zinc-500" size={28} />}
          <span className="line-clamp-2 text-xs font-bold text-zinc-300">{asset.title}</span>
        </div>
      )}

      {asset.mediaType === 'video' && videoUrl && isHovered && (
        <video
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover z-10 opacity-100"
        />
      )}

      <div className={`absolute top-2 left-2 z-30 flex items-center gap-2 transition-all duration-300 ${isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
        <button
          onClick={downloadAsset}
          disabled={!canDownload}
          className="w-8 h-8 rounded-lg bg-black/60 disabled:opacity-40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-brand transition-colors"
          title={canDownload ? 'Download asset' : 'Review or rejected asset cannot be downloaded'}
        >
          <Download size={14} />
        </button>
        <a
          href={asset.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-8 h-8 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          title="Open original source"
        >
          <ExternalLink size={14} />
        </a>
      </div>

      <div className="absolute top-2 right-2 z-30 flex items-center gap-2">
        <span className={`px-2 py-1 rounded-md border text-[8px] font-black uppercase tracking-widest ${statusClass[asset.licenseStatus]}`}>
          {statusLabel[asset.licenseStatus]}
        </span>
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center gap-2">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded-md flex items-center gap-1.5">
          {asset.mediaType === 'video' ? (
            <>
              <Video size={10} className="text-brand-light" fill="currentColor" />
              <span className="text-[8px] font-black text-white uppercase tracking-widest">Video</span>
            </>
          ) : (
            <>
              <ImageIcon size={10} className="text-zinc-300" />
              <span className="text-[8px] font-black text-zinc-300 uppercase tracking-widest">Image</span>
            </>
          )}
        </div>
        <div className="bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded-md">
          <span className="text-[8px] font-black text-zinc-200 uppercase tracking-widest">{asset.provider}</span>
        </div>
      </div>

      <div className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-14 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
        <p className="line-clamp-1 text-xs font-bold text-white">{asset.title}</p>
        <p className="line-clamp-1 text-[10px] text-zinc-300">{asset.license.name}</p>
        {asset.blockedReasons.length > 0 && (
          <p className="line-clamp-2 mt-1 text-[9px] text-amber-100">{asset.blockedReasons.join(' ')}</p>
        )}
        {asset.licenseStatus === 'review_required' && (
          <label className="mt-2 flex items-center gap-2 text-[10px] font-bold text-white" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={Boolean(asset.isManuallyVerified)}
              onChange={(e) => onToggleManualReview(e.target.checked)}
              className="h-3 w-3 accent-brand"
            />
            Verified for monetized YouTube use
          </label>
        )}
      </div>

      {isSelected && (
        <div className="absolute top-2 right-2 z-40 translate-y-8 transition-all duration-300">
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-brand shadow-[0_0_15px_rgba(0,71,171,0.6)]">
            <CheckCircle2 size={14} strokeWidth={4} className="text-white" />
          </div>
        </div>
      )}

      {asset.licenseStatus === 'rejected' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="flex items-center gap-2 rounded-md bg-red-500/90 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
            <AlertCircle size={14} /> Blocked
          </div>
        </div>
      )}

      {isSelected && (
        <div className="absolute inset-0 ring-4 ring-brand/30 ring-inset pointer-events-none transition-all duration-500 shadow-[inset_0_0_50px_rgba(0,71,171,0.2)]" />
      )}
    </motion.div>
  );
};

export default ImageCard;

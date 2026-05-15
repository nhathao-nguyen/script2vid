import { motion, AnimatePresence } from 'motion/react';
import { ScriptSegment } from '../types';
import ImageCard from './ImageCard';
import { ImageIcon, Loader2, AlertCircle, Video } from 'lucide-react';

type GalleryFilter = 'all' | 'stock_safe' | 'commons' | 'review_required' | 'rejected';

interface GalleryProps {
  segments: ScriptSegment[];
  onSelectOption: (segmentId: string, assetId: string) => void;
  onToggleManualReview: (segmentId: string, assetId: string, isManuallyVerified: boolean) => void;
  filter: GalleryFilter;
  isProcessing: boolean;
}

function shouldShowAsset(segment: ScriptSegment, assetId: string, filter: GalleryFilter) {
  const asset = segment.options.find(option => option.id === assetId);
  if (!asset) return false;
  if (filter === 'all') return true;
  if (filter === 'stock_safe') return asset.provider === 'pexels' || asset.provider === 'pixabay';
  if (filter === 'commons') return asset.provider === 'wikimedia' || asset.provider === 'openverse' || asset.provider === 'government';
  if (filter === 'review_required') return asset.licenseStatus === 'review_required';
  if (filter === 'rejected') return asset.licenseStatus === 'rejected';
  return true;
}

export default function Gallery({ segments, onSelectOption, onToggleManualReview, filter, isProcessing }: GalleryProps) {
  if (segments.length === 0 && !isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-zinc-500 space-y-8">
        <div className="relative">
          <ImageIcon size={100} strokeWidth={0.5} className="text-white/10" />
          <motion.div 
            animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 5, repeat: Infinity }}
            className="absolute inset-0 bg-brand/30 blur-[100px] rounded-full"
          />
        </div>
        <div className="text-center space-y-3">
          <p className="text-3xl font-black text-white/40 tracking-tight">Awaiting Narrative</p>
          <p className="text-zinc-500 font-medium tracking-wide text-lg">Enter your script to begin visualization</p>
        </div>
      </div>
    );
  }

  if (segments.length === 0 && isProcessing) {
    return (
      <div className="max-w-6xl mx-auto px-4 space-y-12 animate-pulse">
        <div className="h-20 bg-white/5 rounded-3xl" />
        <div className="h-40 bg-white/5 rounded-3xl" />
        <div className="h-96 bg-white/5 rounded-3xl" />
      </div>
    );
  }

  // Group segments by sentence_id
  const sentenceGroups: { [key: number]: ScriptSegment[] } = {};
  segments.forEach(s => {
    if (!sentenceGroups[s.sentence_id]) sentenceGroups[s.sentence_id] = [];
    sentenceGroups[s.sentence_id].push(s);
  });

  const sortedSentenceIds = Object.keys(sentenceGroups).map(Number).sort((a, b) => a - b);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-24">
      {sortedSentenceIds.map((sentenceId) => {
        const group = sentenceGroups[sentenceId];
        return (
          <div key={sentenceId} className="space-y-12">
            {group.map((segment, index) => (
              <div key={segment.id} className="relative flex gap-8">
                {/* Sidebar Index */}
                <div className="flex flex-col items-center pt-2">
                  <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center text-white font-black text-xl shadow-[0_0_20px_rgba(0,71,171,0.4)]">
                    {sentenceId}
                  </div>
                  <div className="w-px flex-1 bg-white/10 mt-4" />
                </div>

                {/* Main Content Card */}
                <div className="flex-1 space-y-8">
                  {/* 1. Narrative & Translation Block (Only first scene of sentence) */}
                  {index === 0 && (
                    <div className="bg-[#1e2329] border border-white/5 rounded-2xl p-10 space-y-8 shadow-2xl">
                      <div className="space-y-2">
                         <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-1">Narrative Snippet</span>
                         <h3 className="text-2xl lg:text-3xl font-bold text-white/95 leading-tight tracking-tight">
                           {segment.scene_text}
                         </h3>
                      </div>

                      {segment.vietnamese_translation && (
                        <div className="space-y-2 pt-6 border-t border-white/5">
                           <span className="text-[10px] font-black text-brand-light/60 uppercase tracking-[0.2em] px-1">Dịch Tiếng Việt</span>
                           <p className="text-zinc-400 text-lg lg:text-xl font-medium italic opacity-80 leading-relaxed">
                             {segment.vietnamese_translation}
                           </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. Visual Target & Meta Row */}
                  <div className="flex flex-wrap items-center gap-6 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest">Visual Target:</span>
                      <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">{segment.id.toUpperCase()}</span>
                    </div>

                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md shadow-lg ${segment.media_type === 'video' ? 'bg-brand shadow-brand/20' : 'bg-zinc-700 shadow-black/20'}`}>
                      {segment.media_type === 'video' ? (
                        <Video size={12} className="text-white" fill="currentColor" />
                      ) : (
                        <ImageIcon size={12} className="text-white" />
                      )}
                      <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none pt-0.5">
                        {segment.media_type === 'video' ? 'Video' : 'Hình ảnh'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 bg-white/10 border border-white/5 px-3 py-1.5 rounded-md">
                      <AlertCircle size={12} className="text-zinc-400" />
                      <span className="text-[10px] font-black text-zinc-300 uppercase tracking-widest leading-none pt-0.5">Purpose: Pacing</span>
                    </div>

                    <div className="flex flex-wrap gap-2 ml-auto">
                      {segment.keywords.map((kw, i) => (
                        <span key={i} className="text-[10px] font-bold text-zinc-600 uppercase tracking-tighter">
                          #{kw.replace(/\s+/g, '_')}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 3. Media Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
                    <AnimatePresence mode="popLayout">
                      {segment.options.filter(asset => shouldShowAsset(segment, asset.id, filter)).map((asset) => (
                        <ImageCard 
                          key={asset.id}
                          segment={segment}
                          asset={asset}
                          isSelected={segment.selectedAssetId === asset.id}
                          onSelect={() => onSelectOption(segment.id, asset.id)}
                          onToggleManualReview={(isManuallyVerified) => onToggleManualReview(segment.id, asset.id, isManuallyVerified)}
                        />
                      ))}
                    </AnimatePresence>

                    {segment.options.length > 0 && segment.options.every(asset => !shouldShowAsset(segment, asset.id, filter)) && (
                      <div className="aspect-video bg-white/5 border border-white/5 rounded-xl flex flex-col items-center justify-center gap-3 px-6 text-center">
                        <AlertCircle className="text-zinc-500" size={20} />
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">No assets match this filter</span>
                      </div>
                    )}

                    {segment.status === 'searching' && (
                      <div className="aspect-video bg-white/5 border border-white/5 rounded-xl flex flex-col items-center justify-center animate-pulse gap-3">
                        <Loader2 className="animate-spin text-brand/30" size={20} />
                      </div>
                    )}

                    {segment.status === 'error' && (
                      <div className="aspect-video bg-red-500/5 border border-red-500/20 rounded-xl flex flex-col items-center justify-center gap-3 px-6 text-center">
                        <AlertCircle className="text-red-400" size={20} />
                        <span className="text-[10px] font-black text-red-200 uppercase tracking-widest">
                          {segment.error || 'Media search failed'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 4. Editor's Reasoning Box */}
                  <div className="bg-[#1e2329]/50 border border-white/10 rounded-2xl p-8 space-y-6">
                     <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-brand" />
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Editor's Reasoning</span>
                     </div>
                     <div className="space-y-4">
                        <p className="text-zinc-400 text-base font-medium italic">
                          "{segment.scene_summary}"
                        </p>
                        <div className="pt-4 border-t border-white/5 opacity-80">
                          <p className="text-zinc-500 text-sm leading-relaxed">
                            <span className="font-black text-zinc-500 uppercase text-[9px] tracking-widest mr-2">Visual Target:</span>
                            {segment.visual_description}
                          </p>
                        </div>
                     </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

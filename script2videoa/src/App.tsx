import { useState, useEffect, DragEvent, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import { 
  Play, 
  Settings2, 
  FileText, 
  Key, 
  Languages, 
  Layout, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Download,
  Archive,
  Save,
  Film
} from 'lucide-react';
import { AppSettings, MediaAsset, MediaProvider, ScriptSegment, AspectRatio, SearchLanguage } from './types';
import { getGlobalContext, analyzeSentence, splitScriptIntoSentences } from './lib/gemini';
import { downloadMediaBlob, searchLicensedMedia } from './lib/mediaApi';
import { isAssetExportable, shouldAutoSelect } from './lib/licenseGate';
import { buildIntentQueries, extractEntityNames, inferSearchIntent, normalizeMediaTypeForIntent, providerPriorityForIntent } from './lib/scriptIntent';
import Gallery from './components/Gallery';

const SAMPLE_SCRIPT = `In a world where technology and nature coexist, a young traveler discovers a hidden valley.
The sun peaks through the giant redwood trees, casting long shadows on the mossy floor.
Suddenly, a robotic bird lands on a branch, its chrome wings shimmering in the light.
It points towards a mysterious Cave behind the waterfall.`;

const toText = (value: unknown, fallback = '') => (
  typeof value === 'string' && value.trim() ? value : fallback
);

const toStringArray = (value: unknown, fallback: string[] = []) => (
  Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : fallback
);

const getErrorText = (error: unknown, fallback = 'Analysis failed') => {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const text = message.trim() || fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};

const createAnalysisErrorSegment = (sentence: string, sentenceId: number, error: unknown): ScriptSegment => ({
  id: `vs_${sentenceId}_analysis_error`,
  sentence_id: sentenceId,
  scene_count: 0,
  scene_text: sentence,
  vietnamese_translation: '',
  scene_summary: 'Analysis failed',
  visual_meaning: 'The system could not generate visual planning for this sentence.',
  camera_style: '',
  emotion: 'Unknown',
  style: 'Cinematic',
  media_type: 'image',
  keywords: ['analysis_failed'],
  media_queries: [],
  visual_description: 'No visual description was generated because analysis failed.',
  selection_required: false,
  export_file: `${sentenceId}.txt`,
  search_intent: 'documentary',
  entity_names: [],
  provider_priority: [],
  options: [],
  status: 'error',
  error: getErrorText(error),
});

type GalleryFilter = 'all' | 'stock_safe' | 'commons' | 'review_required' | 'rejected';

const FILTER_LABELS: Record<GalleryFilter, string> = {
  all: 'All',
  stock_safe: 'Stock Safe',
  commons: 'Commons',
  review_required: 'Review',
  rejected: 'Rejected',
};

const getAssetKey = (asset: MediaAsset) => asset.downloadUrl || asset.sourceUrl || asset.id;

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

const cleanFilePart = (value: string) => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60) || 'media';

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('pexels_visualizer_settings');
    const defaults: AppSettings = {
      pexelsApiKey: '',
      pixabayApiKey: '',
      language: 'english',
      aspectRatio: 'landscape',
      targetRegion: ''
    };
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  });

  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [segments, setSegments] = useState<ScriptSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('all');

  useEffect(() => {
    localStorage.setItem('pexels_visualizer_settings', JSON.stringify(settings));
  }, [settings]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  const seenUrlsRef = useRef(new Set<string>());
  const activeRunIdRef = useRef(0);
  const markAsSeen = (url: string) => { if (url) seenUrlsRef.current.add(url); };

  const fetchMediaForScene = async (scene: ScriptSegment, runId: number) => {
    try {
      const countNeeded = scene.media_type === 'image' ? 6 : 4;
      let options: MediaAsset[] = [];
      const queries = scene.media_queries.length > 0 ? scene.media_queries : [scene.scene_summary];
      const providers = scene.provider_priority.length > 0
        ? scene.provider_priority
        : providerPriorityForIntent(scene.search_intent, scene.media_type);

      for (const query of queries) {
        if (runId !== activeRunIdRef.current) return;
        if (options.length >= countNeeded) break;

        const results = await searchLicensedMedia({
          query,
          mediaType: scene.media_type,
          aspectRatio: settings.aspectRatio,
          providers,
          perProvider: scene.media_type === 'image' ? 5 : 4,
          apiKeys: {
            pexels: settings.pexelsApiKey,
            pixabay: settings.pixabayApiKey,
          },
        });

        const fresh = results.filter(res => !seenUrlsRef.current.has(getAssetKey(res)));
        const toAdd = (fresh.length > 0 ? fresh : results)
          .filter(res => !options.find(o => getAssetKey(o) === getAssetKey(res)))
          .slice(0, countNeeded - options.length);
        options.push(...toAdd);
        toAdd.forEach(opt => markAsSeen(getAssetKey(opt)));
      }

      if (runId !== activeRunIdRef.current) return;
      const autoSelected = options.find(shouldAutoSelect);

      setSegments(prev => prev.map(s => s.id === scene.id ? {
        ...s,
        status: options.length > 0 ? 'completed' : 'error',
        options,
        selectedAssetId: autoSelected?.id,
        error: options.length > 0 ? undefined : 'No media found'
      } : s));
    } catch (err: any) {
      if (runId !== activeRunIdRef.current) return;
      setSegments(prev => prev.map(s => s.id === scene.id ? { ...s, status: 'error', error: err.message } : s));
    }
  };

  const handleRun = async () => {
    if (!script.trim()) return showToast('Script required', 'error');

    setIsProcessing(true);
    setProgress(0);
    setSegments([]);
    seenUrlsRef.current.clear();
    const runId = activeRunIdRef.current + 1;
    activeRunIdRef.current = runId;

    try {
      const mediaJobs: Promise<void>[] = [];
      let failedSentenceCount = 0;
      showToast('Khởi tạo kịch bản...', 'success');
      const context = await getGlobalContext(script, settings.targetRegion);
      await delay(2000); 

      if (runId !== activeRunIdRef.current) return;
      
      showToast('Đang phân tách kịch bản thành từng câu...', 'success');
      const sentenceList = await splitScriptIntoSentences(script, context);
      await delay(2000);

      if (runId !== activeRunIdRef.current) return;
      if (sentenceList.length === 0) throw new Error('No sentences found in script');
      
      console.log(`Total sentences found: ${sentenceList.length}`);
      
      for (let i = 0; i < sentenceList.length; i++) {
        const sentence = sentenceList[i].trim();
        if (!sentence) continue;
        
        if (i > 0) await delay(4500); // Slightly more delay for stability

        if (runId !== activeRunIdRef.current) return;
        
        showToast(`Đang phân tích câu ${i + 1}/${sentenceList.length}`, 'success');
        try {
          const analysis = await analyzeSentence(sentence, i + 1, context, settings.language, settings.targetRegion);

          const possibleScenes = Array.isArray(analysis) ? analysis : (analysis?.scenes || analysis?.scene || analysis?.visual_scenes || [analysis]);
          const rawScenes = (Array.isArray(possibleScenes) ? possibleScenes : [possibleScenes]).filter(s => s && typeof s === 'object' && (s.media_queries || s.keywords || s.scene_summary));
          if (analysis && rawScenes.length > 0) {
            const sentenceId = Number(analysis.sentence_id) || i + 1;
            const newScenes: ScriptSegment[] = rawScenes.map((scene: any, index: number) => {
              const summary = toText(scene.scene_summary, sentence);
              const keywords = toStringArray(scene.keywords, [summary]);
              const aiEntities = toStringArray(scene.entity_names);
              const heuristicEntities = extractEntityNames(`${sentence} ${summary} ${keywords.join(' ')}`);
              const entityNames = [...new Set([...aiEntities, ...heuristicEntities])];
              const searchIntent = toText(scene.search_intent, inferSearchIntent(`${sentence} ${summary}`, entityNames)) as ScriptSegment['search_intent'];
              const normalizedIntent = ['stock', 'real_person', 'real_event', 'place', 'documentary', 'abstract'].includes(searchIntent)
                ? searchIntent
                : inferSearchIntent(`${sentence} ${summary}`, entityNames);
              const mediaType = normalizeMediaTypeForIntent(scene.media_type === 'video' ? 'video' : 'image', normalizedIntent, `${sentence} ${summary}`);
              const mediaQueries = buildIntentQueries(toStringArray(scene.media_queries, keywords), summary, entityNames, normalizedIntent);
              const providerPriority = providerPriorityForIntent(normalizedIntent, mediaType);

              return {
                id: `vs_${sentenceId}_${index + 1}`,
                sentence_id: sentenceId,
                scene_count: rawScenes.length,
                scene_text: toText(analysis.sentence_text, sentence),
                vietnamese_translation: toText(analysis.vietnamese_translation),
                scene_summary: summary,
                visual_meaning: toText(scene.visual_meaning),
                camera_style: toText(scene.camera_style),
                emotion: toText(scene.emotion, 'Neutral'),
                style: toText(scene.style, 'Cinematic'),
                media_type: mediaType,
                keywords,
                media_queries: mediaQueries.length > 0 ? mediaQueries : [summary],
                visual_description: toText(scene.visual_description, summary),
                selection_required: true,
                export_file: toText(analysis.export_file, `${sentenceId}.txt`),
                search_intent: normalizedIntent,
                entity_names: entityNames,
                provider_priority: providerPriority,
                options: [],
                status: 'searching'
              };
            });

            setSegments(prev => [...prev, ...newScenes]);
            mediaJobs.push(...newScenes.map(scene => fetchMediaForScene(scene, runId)));
          } else {
            failedSentenceCount += 1;
            console.error(`Failed to analyze sentence ${i + 1}: Gemini returned no scenes`);
            setSegments(prev => [...prev, createAnalysisErrorSegment(sentence, i + 1, 'Gemini returned no scenes')]);
            showToast(`Lỗi khi xử lý câu ${i + 1}, đang tiếp tục...`, 'error');
          }
        } catch (error) {
          if (runId !== activeRunIdRef.current) return;
          failedSentenceCount += 1;
          console.error(`Failed to analyze sentence ${i + 1}`, error);
          setSegments(prev => [...prev, createAnalysisErrorSegment(sentence, i + 1, error)]);
          showToast(`Lỗi khi xử lý câu ${i + 1}, đang tiếp tục...`, 'error');
        } finally {
          if (runId === activeRunIdRef.current) {
            setProgress(Math.round(((i + 1) / sentenceList.length) * 100));
          }
        }
      }

      if (mediaJobs.length > 0) {
        showToast('Đang tìm media có license cho các cảnh...', 'success');
        await Promise.allSettled(mediaJobs);
      }

      if (runId === activeRunIdRef.current) {
        if (failedSentenceCount > 0) {
          showToast(`Hoàn tất ${sentenceList.length - failedSentenceCount}/${sentenceList.length} câu. ${failedSentenceCount} câu bị lỗi.`, 'error');
        } else {
          showToast('Hoàn tất toàn bộ kịch bản!');
        }
      }
    } catch (error: any) {
      if (runId === activeRunIdRef.current) {
        showToast(error?.message || 'Execution failed', 'error');
      }
    } finally {
      if (runId === activeRunIdRef.current) {
        setIsProcessing(false);
        setProgress(0);
      }
    }
  };

  const handleSelectOption = (segmentId: string, assetId: string) => {
    const segment = segments.find(s => s.id === segmentId);
    const asset = segment?.options.find(option => option.id === assetId);

    if (!asset) return;
    if (asset.licenseStatus === 'rejected') {
      return showToast('Rejected assets cannot be selected', 'error');
    }
    if (asset.licenseStatus === 'review_required' && !asset.isManuallyVerified) {
      showToast('Manual license review required before export', 'error');
    }

    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, selectedAssetId: assetId } : s));
  };

  const handleToggleManualReview = (segmentId: string, assetId: string, isManuallyVerified: boolean) => {
    setSegments(prev => prev.map(segment => {
      if (segment.id !== segmentId) return segment;

      return {
        ...segment,
        options: segment.options.map(asset => asset.id === assetId
          ? {
              ...asset,
              isManuallyVerified,
              reviewNotes: isManuallyVerified
                ? 'Verified by user for monetized YouTube use.'
                : undefined
            }
          : asset
        )
      };
    }));
  };

  const reloadScene = (segmentId: string) => {
    const scene = segments.find(s => s.id === segmentId);
    if (scene) {
      setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, status: 'searching' } : s));
      fetchMediaForScene(scene, activeRunIdRef.current);
    }
  };

  const handleExportBatch = async () => {
    if (segments.length === 0) return;
    setIsProcessing(true);
    try {
      const zip = new JSZip();
      const fileMap = new Map<string, string>();
      segments.forEach(s => fileMap.set(s.export_file, s.scene_text));
      fileMap.forEach((content, name) => zip.file(name, content));
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'batch.zip';
      a.click();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportSummary = () => {
    const ids = Array.from(new Set(segments.map(s => s.sentence_id))) as number[];
    ids.sort((a, b) => a - b);
    const summaryLines = ids.map(id => `${id} ${segments.find(s => s.sentence_id === id)?.scene_count || 0}`);
    const blob = new Blob([summaryLines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'summary.txt';
    a.click();
  };

  const handleExportVideoZip = async () => {
    if (segments.some(s => s.status === 'searching')) return showToast('Media search is still running', 'error');
    const selected = segments.filter(s => s.selectedAssetId);
    if (selected.length === 0) return showToast('No media selected', 'error');

    const blocked = selected
      .map(segment => ({
        segment,
        asset: segment.options.find(option => option.id === segment.selectedAssetId),
      }))
      .filter(item => !item.asset || !isAssetExportable(item.asset));

    if (blocked.length > 0) {
      return showToast('Some selected assets need review or are rejected', 'error');
    }

    setIsProcessing(true);
    try {
      const zip = new JSZip();
      const manifest: any[] = [];
      const creditLines: string[] = [
        '# Media Credits',
        '',
        'License-safe export generated by the app. License compliance does not by itself guarantee YouTube monetization; videos still need original script, narration, editing, commentary, or other substantial creative value.',
        ''
      ];
      const reviewLog: any[] = [];

      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        const opt = s.options.find(o => o.id === s.selectedAssetId);
        if (!opt) continue;
        
        try {
          const res = await downloadMediaBlob(opt);
          const blob = await res.blob();
          
          const extension = extensionFromContentType(
            res.headers.get('Content-Type'),
            s.media_type === 'video' ? 'mp4' : 'jpg'
          );

          const baseName = `${(i + 1).toString().padStart(2, '0')}_${cleanFilePart(s.keywords.slice(0, 3).join('_'))}_${cleanFilePart(opt.provider)}_${cleanFilePart(opt.id)}`;
          const finalName = `${baseName}.${extension}`;
          
          zip.file(finalName, blob);
          manifest.push({
            file: finalName,
            segmentId: s.id,
            sentenceId: s.sentence_id,
            sceneText: s.scene_text,
            sceneSummary: s.scene_summary,
            asset: opt,
          });

          if (opt.license.requiresAttribution || opt.licenseStatus === 'attribution_required' || opt.provider === 'wikimedia') {
            creditLines.push(`- ${opt.attributionText}`);
          }

          if (opt.isManuallyVerified || opt.licenseStatus === 'review_required') {
            reviewLog.push({
              assetId: opt.id,
              sourceUrl: opt.sourceUrl,
              license: opt.license,
              licenseStatus: opt.licenseStatus,
              isManuallyVerified: Boolean(opt.isManuallyVerified),
              reviewNotes: opt.reviewNotes || '',
              reviewedAt: opt.isManuallyVerified ? new Date().toISOString() : null,
            });
          }
        } catch (e) {
          console.error(`Failed to download ${opt.downloadUrl}`, e);
        }
      }

      zip.file('asset_manifest.json', JSON.stringify({
        generatedAt: new Date().toISOString(),
        youtubePolicyNote: 'License compliance does not by itself guarantee monetization. Avoid reused content by adding original narration, script, editing, commentary, or analysis.',
        assets: manifest,
      }, null, 2));
      zip.file('credits.md', creditLines.join('\n'));
      zip.file('youtube_description_credits.txt', creditLines.filter(line => line.startsWith('- ')).map(line => line.slice(2)).join('\n'));
      zip.file('review_log.json', JSON.stringify(reviewLog, null, 2));

      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(content);
      a.download = `cinematic_assets_${new Date().getTime()}.zip`;
      a.click();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (event) => {
        setScript(event.target?.result as string);
        showToast('Script imported');
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-main)] text-[var(--color-text-high)] font-sans selection:bg-brand/30">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-8 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 backdrop-blur-2xl border ${
              toast.type === 'error' ? 'bg-red-500/20 border-red-500/40 text-red-100' : 'bg-brand/20 border-brand/40 text-white'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={22} className="text-red-400" /> : <CheckCircle2 size={22} className="text-brand-light" />}
            <span className="text-sm font-bold tracking-wide uppercase">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col lg:flex-row h-screen overflow-hidden">
        <aside className="w-full lg:w-[30%] border-r border-white/5 bg-[var(--color-bg-panel)] flex flex-col z-40">
          <header className="p-6 border-b border-white/10 bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Film size={24} className="text-brand" />
              <div className="flex flex-col">
                <h1 className="text-lg font-black tracking-tighter uppercase">AI Studio</h1>
                <span className="text-[8px] font-black text-brand-light uppercase tracking-[0.3em]">Cinematic Engine</span>
              </div>
            </div>
            <Settings2 size={20} className="text-zinc-600 cursor-pointer hover:rotate-90 transition-transform duration-500" />
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-8 minimal-scrollbar">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2 px-1">
                  <FileText size={12} /> Narrative Script
                </span>
              </div>
              <div 
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                className="relative group h-64 lg:h-80"
              >
                <textarea
                  value={script} onChange={(e) => setScript(e.target.value)}
                  className="w-full h-full p-6 bg-[var(--color-bg-input)] border border-white/5 rounded-2xl text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-brand/50 transition-all placeholder:text-zinc-700"
                  placeholder="Enter your script or drop a .txt file..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <Key size={12} /> Pexels API Key (Optional if set on server)
                </label>
                <input
                  type="password" value={settings.pexelsApiKey} onChange={(e) => setSettings({ ...settings, pexelsApiKey: e.target.value })}
                  placeholder="Paste your key here..."
                  className="w-full px-5 py-3 bg-[var(--color-bg-input)] border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-brand/50 outline-none"
                />
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <Key size={12} /> Pixabay API Key (Optional if set on server)
                </label>
                <input
                  type="password" value={settings.pixabayApiKey} onChange={(e) => setSettings({ ...settings, pixabayApiKey: e.target.value })}
                  placeholder="Paste your key here..."
                  className="w-full px-5 py-3 bg-[var(--color-bg-input)] border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-brand/50 outline-none"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                    <Languages size={12} /> Search Mode
                  </label>
                  <select
                    value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value as SearchLanguage })}
                    className="w-full px-5 py-3 bg-[var(--color-bg-input)] border border-white/5 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-brand/50 outline-none"
                  >
                    <option value="english">English AI</option>
                    <option value="original">Contextual</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                    <Layout size={12} /> Ratio
                  </label>
                  <select
                    value={settings.aspectRatio} onChange={(e) => setSettings({ ...settings, aspectRatio: e.target.value as AspectRatio })}
                    className="w-full px-5 py-3 bg-[var(--color-bg-input)] border border-white/5 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-brand/50 outline-none"
                  >
                    <option value="landscape">16:9</option>
                    <option value="portrait">9:16</option>
                    <option value="square">1:1</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                  <Languages size={12} /> Target Content Region (Optional)
                </label>
                <input
                  type="text" 
                  value={settings.targetRegion} 
                  onChange={(e) => setSettings({ ...settings, targetRegion: e.target.value })}
                  placeholder="e.g. Vietnam, Japan, Cyberpunk..."
                  className="w-full px-5 py-3 bg-[var(--color-bg-input)] border border-white/5 rounded-xl text-sm focus:ring-2 focus:ring-brand/50 outline-none"
                />
                <p className="text-[9px] text-zinc-600 font-medium px-1">Influences AI search queries & visual style.</p>
              </div>
            </div>

            <AnimatePresence>
              {(isProcessing || progress > 0) && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="p-5 bg-brand/5 border border-brand/20 rounded-2xl space-y-4">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-brand-light">
                    <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={14} />Processing</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${progress}%` }} className="h-full bg-brand shadow-[0_0_10px_brand]" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <footer className="p-6 border-t border-white/5 bg-black/20">
            <button
              onClick={handleRun} disabled={isProcessing}
              className="w-full py-4 rounded-2xl bg-brand hover:bg-brand-light text-white font-black text-sm uppercase tracking-[0.2em] flex items-center justify-center gap-3 disabled:opacity-40 shadow-lg shadow-brand/20 transition-all"
            >
              {isProcessing ? <Loader2 className="animate-spin" /> : <Play size={18} fill="currentColor" />}
              {isProcessing ? 'Analyzing' : 'Generate'}
            </button>
          </footer>
        </aside>

        <main className="flex-1 bg-[var(--color-bg-main)] overflow-y-auto minimal-scrollbar flex flex-col">
          {segments.length > 0 && (
            <div className="sticky top-0 z-30 px-8 py-4 bg-[#14181c]/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <h2 className="text-xl font-black text-white/95 tracking-tight">Scene Timeline</h2>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="bg-[#1e2329] border border-white/10 px-4 py-2 rounded-md flex items-center gap-3 shadow-inner">
                  <span className="text-[10px] font-black text-brand-light uppercase tracking-widest">Target Visuals:</span>
                  <span className="text-sm font-black text-white">
                    {segments.filter(s => s.selectedAssetId).length} / {segments.length}
                  </span>
                </div>

                <button 
                  onClick={handleExportVideoZip}
                  className="h-10 px-6 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-md border border-white/5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  <Download size={14} /> Download Media Assets
                </button>

                <div className="flex items-center gap-1 ml-4">
                  {(Object.keys(FILTER_LABELS) as GalleryFilter[]).map(filter => (
                    <button
                      key={filter}
                      onClick={() => setGalleryFilter(filter)}
                      className={`h-10 px-3 rounded-md border text-[9px] font-black uppercase tracking-widest transition-colors ${
                        galleryFilter === filter
                          ? 'bg-brand border-brand text-white'
                          : 'bg-white/5 hover:bg-white/10 border-white/5 text-zinc-500 hover:text-white'
                      }`}
                    >
                      {FILTER_LABELS[filter]}
                    </button>
                  ))}
                  <button onClick={handleExportBatch} className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-md border border-white/5 flex items-center justify-center text-zinc-500 hover:text-white transition-colors" title="Export Batch Text"><Archive size={16} /></button>
                  <button onClick={handleExportSummary} className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-md border border-white/5 flex items-center justify-center text-zinc-500 hover:text-white transition-colors" title="Export Summary"><Save size={16} /></button>
                </div>
              </div>
            </div>
          )}
          <div className="p-8 lg:p-12 max-w-[1600px] mx-auto w-full flex-1">
            <Gallery 
              segments={segments} 
              onSelectOption={handleSelectOption} 
              onToggleManualReview={handleToggleManualReview}
              filter={galleryFilter}
              isProcessing={isProcessing}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

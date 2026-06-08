import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Monitor, Mic, ArrowLeft, Check } from 'lucide-react';

type Stage = 'permission' | 'setup' | 'loading';

export function PreInterviewFlow({ onReady, onBack }: { onReady: () => void; onBack: () => void }) {
  const [stage, setStage] = useState<Stage>('permission');
  const [screenShared, setScreenShared] = useState(false);
  const [consented, setConsented] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleShareScreen = () => {
    setScreenShared(true);
    setStage('setup');
  };

  const handleStartInterview = () => {
    if (!consented) return;
    setStage('loading');
  };

  // Loading progress
  useEffect(() => {
    if (stage !== 'loading') return;
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(onReady, 350);
          return 100;
        }
        return p + Math.random() * 8 + 2;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [stage, onReady]);

  return (
    <div className="min-h-screen bg-mauve-50 flex flex-col">
      {/* Top bar */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-ink-200/70 bg-ink-0/60 backdrop-blur-sm">
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-lg hover:bg-mauve-50 flex items-center justify-center text-ink-400 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-ink-900 flex items-center justify-center">
            <span className="font-ui text-ink-0 font-bold text-sm">M</span>
          </div>
          <span className="font-display text-ink-900 font-semibold">Merism</span>
        </div>
        <div className="w-8" />
      </header>

      {/* Stage content */}
      <div className="flex-1 flex items-center justify-center px-6 relative">
        <AnimatePresence mode="wait">
          {stage === 'permission' && (
            <PermissionStage key="permission" onShare={handleShareScreen} />
          )}
          {stage === 'setup' && (
            <SetupStage
              key="setup"
              consented={consented}
              onConsent={setConsented}
              onStart={handleStartInterview}
            />
          )}
          {stage === 'loading' && <LoadingStage key="loading" progress={progress} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ────────── Stage 1: Permission modal ────────── */
function PermissionStage({ onShare }: { onShare: () => void }) {
  return (
    <>
      {/* Dimmed faux background hint */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
        <div className="text-center">
          <h2 className="font-display text-ink-900" style={{ fontSize: '2rem', fontWeight: 600 }}>
            Is everything set up correctly?
          </h2>
          <p className="font-ui text-ink-600 text-sm mt-2">
            Please make sure all three of camera, microphone, and screen share are connected and functional.
          </p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative bg-ink-0 rounded-2xl border border-ink-200 px-10 py-10 max-w-md w-full text-center shadow-lg"
      >
        <h2 className="font-display text-ink-900 mb-8" style={{ fontSize: '1.4rem', fontWeight: 600, lineHeight: 1.3 }}>
          Share your entire screen to continue the interview
        </h2>

        {/* Illustration */}
        <div className="flex justify-center mb-8">
          <div className="w-32 h-32 rounded-full bg-mauve-50 flex items-center justify-center">
            <Monitor size={56} className="text-ink-800" strokeWidth={1.5} />
          </div>
        </div>

        <p className="font-ui text-ink-600 text-sm leading-relaxed mb-8 px-2">
          Merism requires permission to your entire screen in order to continue the interview process.
        </p>

        <button
          onClick={onShare}
          className="px-8 py-2.5 rounded-full bg-mauve-200 hover:bg-mauve-100 text-ink-900 font-ui font-medium text-sm transition-colors shadow-sm"
        >
          Share screen
        </button>
      </motion.div>
    </>
  );
}

/* ────────── Stage 2: Setup check ────────── */
function SetupStage({
  consented,
  onConsent,
  onStart,
}: {
  consented: boolean;
  onConsent: (v: boolean) => void;
  onStart: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.35 }}
      className="w-full max-w-3xl text-center"
    >
      <h2 className="font-display text-ink-900 mb-2" style={{ fontSize: '1.75rem', fontWeight: 600 }}>
        Is everything set up correctly?
      </h2>
      <p className="font-ui text-ink-600 text-sm mb-8">
        Please make sure all three of camera, microphone, and screen share are connected and functional.
      </p>

      {/* Preview: screen share with floating camera */}
      <div className="relative mx-auto mb-6 rounded-xl overflow-hidden border border-ink-200 bg-ink-900 aspect-[16/9] max-w-2xl shadow-md">
        <img
          src="https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=1200&q=80"
          alt="Screen share preview"
          className="w-full h-full object-cover"
        />
        {/* Floating webcam */}
        <div className="absolute top-3 right-3 w-28 h-20 rounded-lg overflow-hidden border-2 border-ink-0/80 shadow-md">
          <img
            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80"
            alt="Your camera"
            className="w-full h-full object-cover object-top"
          />
        </div>
      </div>

      {/* Mic + screen source row */}
      <div className="flex items-center justify-center gap-8 text-sm text-ink-600 mb-8">
        <div className="flex items-center gap-2 font-ui">
          <Mic size={14} className="text-ink-400" />
          <span>Default - MacBook Pro Microphone (Built-in)</span>
        </div>
        <button className="flex items-center gap-1.5 font-ui text-ink-800 hover:text-ink-900 transition-colors">
          <Monitor size={14} />
          Change Screenshare Source
        </button>
      </div>

      {/* Consent */}
      <div className="flex justify-center mb-6">
        <label className="inline-flex items-center gap-2.5 font-ui text-sm text-ink-600 cursor-pointer select-none whitespace-nowrap">
          <button
            type="button"
            onClick={() => onConsent(!consented)}
            className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors shrink-0 ${
              consented ? 'bg-mauve-200 border-ink-900' : 'bg-ink-0 border-ink-200'
            }`}
          >
            {consented && <Check size={12} className="text-ink-900" strokeWidth={3} />}
          </button>
          <span className="leading-none">I confirm that I am sharing my entire screen. I acknowledge and consent to being recorded during this session.</span>
        </label>
      </div>

      <button
        onClick={onStart}
        disabled={!consented}
        className={`px-8 py-2.5 rounded-full font-ui font-medium text-sm transition-all ${
          consented
            ? 'bg-mauve-200 hover:bg-mauve-100 text-ink-900 shadow-sm'
            : 'bg-ink-100 text-ink-400 cursor-not-allowed'
        }`}
      >
        Start interview
      </button>
    </motion.div>
  );
}

/* ────────── Stage 3: Loading ────────── */
function LoadingStage({ progress }: { progress: number }) {
  const clamped = Math.min(Math.round(progress), 100);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-xl text-center"
    >
      <h2 className="font-display text-ink-900 mb-10" style={{ fontSize: '1.75rem', fontWeight: 600 }}>
        Setting up your interview
      </h2>

      {/* Animated illustration */}
      <div className="flex justify-center mb-10">
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          className="w-48 h-48 rounded-full bg-mauve-50 flex items-center justify-center relative"
        >
          <svg viewBox="0 0 120 120" className="w-32 h-32 text-ink-800" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {/* Clipboard */}
            <rect x="35" y="20" width="50" height="80" rx="4" />
            <line x1="45" y1="35" x2="75" y2="35" />
            <line x1="45" y1="45" x2="75" y2="45" />
            <line x1="45" y1="55" x2="70" y2="55" />
            <line x1="45" y1="65" x2="75" y2="65" />
            <line x1="45" y1="75" x2="65" y2="75" />
            {/* Robot head */}
            <circle cx="95" cy="35" r="10" />
            <circle cx="92" cy="34" r="1.5" fill="currentColor" />
            <circle cx="98" cy="34" r="1.5" fill="currentColor" />
            <line x1="95" y1="22" x2="95" y2="18" />
            <circle cx="95" cy="16" r="1.5" fill="currentColor" />
          </svg>
        </motion.div>
      </div>

      <p className="font-data text-ink-900 font-semibold text-sm mb-3">{clamped}%</p>

      <div className="h-2 bg-ink-200 rounded-full overflow-hidden mb-4 max-w-md mx-auto">
        <motion.div
          className="h-full bg-mauve-200 rounded-full"
          animate={{ width: `${clamped}%` }}
          transition={{ ease: 'easeOut', duration: 0.3 }}
        />
      </div>

      <p className="font-ui text-ink-400 text-xs">
        This may take a few moments. Please do not refresh the page.
      </p>
    </motion.div>
  );
}

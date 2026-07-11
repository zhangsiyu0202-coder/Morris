import React, { useState, useEffect, useRef } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, ChevronRight,
  Volume2, Sparkles, Clock, CheckCircle2, Circle, Loader2
} from 'lucide-react';
import { PreInterviewFlow } from './PreInterviewFlow';

const AI_MESSAGES = [
  {
    id: 1,
    text: "Hi there! Thanks for joining today. I'm your AI interviewer. We'll spend about 20 minutes exploring a few concept ideas together — there are no right or wrong answers.",
    delay: 0,
  },
  {
    id: 2,
    text: "Let's start with a warm-up. Could you tell me a bit about the kinds of snacks you typically reach for during the week?",
    delay: 3500,
  },
  {
    id: 3,
    text: "That's really helpful context! Now let's look at a concept together. I'll share something on the right. Take a moment to read it over.",
    delay: 12000,
  },
  {
    id: 4,
    text: "Oh, that sounds like a solid plan! Let's move on to the snack concept. Take a look at the concept visual of Frutique Clusters. Would you try this snack? Please share your thinking.",
    delay: 18000,
  },
];

const STIMULUS_BULLETS = [
  "Amazonian Acaí & Cashew",
  "Goji Berry & Almond",
  "Caribbean Coconut & Macadamia",
  "Mango Chili Lime",
];

type RecordingState = 'idle' | 'recording' | 'processing';

export function CandidatePage({ onLeave }: { onLeave: () => void }) {
  const [interviewStarted, setInterviewStarted] = useState(false);

  if (!interviewStarted) {
    return <PreInterviewFlow onReady={() => setInterviewStarted(true)} onBack={onLeave} />;
  }

  return <InterviewSession onLeave={onLeave} />;
}

function InterviewSession({ onLeave }: { onLeave: () => void }) {
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [visibleMessages, setVisibleMessages] = useState<typeof AI_MESSAGES>([]);
  const [stimulusVisible, setStimulusVisible] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Drip-feed AI messages
  useEffect(() => {
    AI_MESSAGES.forEach((msg) => {
      setTimeout(() => {
        setVisibleMessages((prev) => [...prev, msg]);
        if (msg.id === 3) setStimulusVisible(true);
      }, msg.delay);
    });
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  // Timer
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleBeginResponse = () => {
    if (recordingState === 'idle') {
      setRecordingState('recording');
    } else if (recordingState === 'recording') {
      setRecordingState('processing');
      setTimeout(() => setRecordingState('idle'), 1800);
    }
  };

  const progress = Math.min((elapsed / 1200) * 100, 100); // 20 min total

  return (
    <div className="flex flex-col h-screen bg-ink-900 overflow-hidden">
      {/* ── Top Bar ── */}
      <header className="h-14 flex items-center justify-between px-6 bg-ink-900 border-b border-ink-0/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-ink-800 flex items-center justify-center shrink-0">
              <span className="font-ui text-ink-0 font-bold" style={{ fontSize: '0.95rem' }}>M</span>
            </div>
            <span className="font-display text-ink-0 font-semibold" style={{ fontSize: '1rem' }}>Merism</span>
          </div>
          <div className="flex items-center gap-1.5 text-ink-400">
            <Clock size={13} />
            <span className="font-data text-xs">{formatTime(elapsed)}</span>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 flex-1 mx-12 max-w-xs">
          <div className="flex-1 h-1 bg-ink-0/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-mauve-200 rounded-full transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-data text-xs text-ink-400 shrink-0">{Math.round(progress)}%</span>
        </div>


      </header>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Chat + Self-Cam ── */}
        <div className="w-[380px] flex flex-col shrink-0 border-r border-ink-0/10">
          {/* Chat Transcript — fills top 2/3 */}
          <div className="overflow-y-auto px-4 py-4 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-ink-0/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-ink-0/20" style={{ flex: '0 0 66.666%', minHeight: 0 }}>
            <p className="font-ui text-[10px] font-semibold text-ink-400 uppercase tracking-widest text-center mb-4">
              Conversation
            </p>

            {visibleMessages.map((msg, idx) => (
              <div key={msg.id} className="flex flex-col gap-1 animate-fade-in">
                {idx === 0 && (
                  <span className="font-ui text-[10px] text-mauve-200 font-semibold uppercase tracking-wider">
                    AI Interviewer
                  </span>
                )}
                {idx > 0 && visibleMessages[idx - 1]?.id !== msg.id && (
                  <span className="font-ui text-[10px] text-mauve-200 font-semibold uppercase tracking-wider mt-2">
                    AI Interviewer
                  </span>
                )}
                <div className="bg-ink-800 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[95%]">
                  <p className="font-reading text-sm text-ink-100 leading-relaxed">{msg.text}</p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {visibleMessages.length < AI_MESSAGES.length && (
              <div className="flex items-center gap-1.5 px-4 py-2">
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <div
                      key={d}
                      className="w-1.5 h-1.5 bg-ink-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
                <span className="font-ui text-xs text-ink-400">AI is typing…</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Candidate Self-Cam — bottom 1/3 */}
          <div className="relative bg-ink-900 overflow-hidden border-t border-ink-0/10" style={{ flex: '0 0 33.333%', minHeight: 0 }}>
            {videoOn ? (
              <img
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80"
                alt="You"
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-mauve-200 flex items-center justify-center text-lg font-bold text-ink-900">
                  AR
                </div>
              </div>
            )}
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900/60 via-transparent to-transparent" />

            {/* Name + speaking indicator */}
            <div className="absolute bottom-2.5 left-3 flex items-center gap-2">
              <div className="flex gap-0.5 items-end h-3.5">
                {[3, 5, 4, 6, 3, 5, 4].map((h, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-mauve-200 rounded-full animate-pulse"
                    style={{
                      height: `${h * 1.8}px`,
                      animationDelay: `${i * 80}ms`,
                      animationDuration: '700ms',
                    }}
                  />
                ))}
              </div>
              <span className="font-ui text-xs text-ink-0/80 font-medium">You</span>
            </div>

            {!micOn && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-ink-900 border border-ink-0/40 rounded-full flex items-center justify-center text-ink-0">
                <MicOff size={10} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Stimulus Content ── */}
        <div
          className="flex-1 overflow-y-auto transition-all duration-700 bg-mauve-50"
        >
          {stimulusVisible ? (
            <div className="max-w-2xl mx-auto px-10 py-8">
              {/* Stimulus label */}
              <div className="flex items-center gap-2 mb-6">
                <div className="h-px flex-1 bg-ink-200" />
                <span className="font-ui text-[11px] font-semibold text-ink-400 uppercase tracking-widest px-3">
                  Concept to Review
                </span>
                <div className="h-px flex-1 bg-ink-200" />
              </div>

              {/* Article header */}
              <h1 className="font-display text-ink-900 mb-2" style={{ fontSize: '1.6rem', fontWeight: 600, lineHeight: 1.25 }}>
                Frutique Clusters: Exotic Bite-Sized Delights
              </h1>
              <p className="font-reading text-ink-600 text-sm mb-6 leading-relaxed">
                Unwrap the taste of paradise with Frutique Clusters, the perfect symphony of exotic fruits and premium nuts. Each cluster is a natural indulgence, with textures and flavors that transport you to the lush corners of the globe.
              </p>

              {/* Product images */}
              <div className="grid grid-cols-2 gap-3 mb-8">
                <div className="rounded-xl overflow-hidden aspect-[4/3] bg-ink-100">
                  <img
                    src="https://images.unsplash.com/photo-1677047637764-377f1ca98ac9?w=600&q=80"
                    alt="Frutique Clusters product"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="rounded-xl overflow-hidden aspect-[4/3] bg-ink-100">
                  <img
                    src="https://images.unsplash.com/photo-1602050580420-45f0364bc792?w=600&q=80"
                    alt="Frutique Clusters fruits"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              {/* Flavor list */}
              <div className="bg-ink-0 rounded-2xl border border-ink-100 p-6 mb-6 shadow-sm">
                <h3 className="font-display text-ink-900 mb-4" style={{ fontSize: '1rem', fontWeight: 600 }}>
                  Our clusters come in a variety of flavors:
                </h3>
                <ul className="space-y-2">
                  {STIMULUS_BULLETS.map((b) => (
                    <li key={b} className="flex items-center gap-3 font-ui text-sm text-ink-600">
                      <CheckCircle2 size={16} className="text-ink-900 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Footer note */}
              <div className="bg-mauve-50 border border-ink-200 rounded-xl px-5 py-4">
                <p className="font-ui text-sm text-ink-600 leading-relaxed">
                  Packaged in eco-friendly pouches, Frutique Clusters are your guilt-free pass to snack on the wild side. They're preservative-free, non-GMO, and contain no artificial sweeteners, making them a nutritious pick-me-up any time of the day.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-16 h-16 rounded-full bg-ink-100 flex items-center justify-center mb-4">
                <Loader2 size={24} className="text-ink-400 animate-spin" />
              </div>
              <p className="font-ui text-ink-400 text-sm">Waiting for the interviewer to share content…</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Controls ── */}
      <div className="h-20 bg-ink-900 border-t border-ink-0/10 flex items-center justify-between px-8 shrink-0">
        {/* Media controls */}
        <div className="flex items-center gap-3">


        </div>

        {/* Response CTA */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={handleBeginResponse}
            className={`flex items-center gap-2.5 px-8 py-3 rounded-full font-ui font-semibold text-sm transition-all shadow-md ${
              recordingState === 'idle'
                ? 'bg-mauve-200 hover:bg-mauve-100 text-ink-900'
                : recordingState === 'recording'
                ? 'bg-ink-0 hover:bg-mauve-50 text-ink-900 animate-pulse'
                : 'bg-ink-0/10 text-ink-400 cursor-not-allowed'
            }`}
            disabled={recordingState === 'processing'}
          >
            {recordingState === 'idle' && (
              <>
                <Mic size={16} />
                Begin Response
              </>
            )}
            {recordingState === 'recording' && (
              <>
                <div className="w-3 h-3 bg-ink-900 rounded-sm" />
                Stop Recording
              </>
            )}
            {recordingState === 'processing' && (
              <>
                <Loader2 size={16} className="animate-spin" />
                Processing…
              </>
            )}
          </button>
          {recordingState === 'idle' && (
            <p className="font-ui text-[11px] text-ink-400">Press to share your thoughts</p>
          )}
          {recordingState === 'recording' && (
            <p className="font-ui text-[11px] text-ink-0/80 animate-pulse">Recording your response…</p>
          )}
        </div>

        {/* Next question */}
        <button className="flex items-center gap-1.5 font-ui text-ink-400 hover:text-ink-100 transition-colors text-sm">
          Skip
          <ChevronRight size={16} />
        </button>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.35s ease both; }
      `}</style>
    </div>
  );
}

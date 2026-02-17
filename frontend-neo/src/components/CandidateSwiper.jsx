import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import CandidateCard from './CandidateCard';
import SwipeControls from './SwipeControls';
import StatsPanel from './StatsPanel';
import PitchModal from './PitchModal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { motion, AnimatePresence } from 'framer-motion';

const RECRUITER_MESSAGES = [
  "Sourcing candidates from the multiverse",
  "Ignoring candidates who used Comic Sans",
  "Translating 'Self-starter' to 'Needs no supervision'",
  "Filtering out 'Rockstars' and 'Ninjas'",
  "Cross-referencing LinkedIn profiles with reality",
  "Analyzing salary expectations vs. budget reality",
  "Checking if 'Expert' means 'Watched a YouTube tutorial'",
  "Simulating 15 rounds of interviews",
  "Bribing top talent with virtual coffee",
  "Reading between the lines of 'Team Player'",
  "Wondering if 'Ping Pong' is a core competency",
  "Ghosting candidates... just kidding, we're better",
  "Optimizing for maximum synergistic alignment",
  "Polishing 'keep your resume on file' templates",
  "Decrypting 'Competitive Salary' packages"
];

const AnimatedEllipsis = () => {
  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        repeat: Infinity,
        duration: 1,
        repeatType: "reverse"
      }}
    >
      ...
    </motion.span>
  );
};

const RecruiterLoading = ({ totalSourced }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % RECRUITER_MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <div className="mb-8 relative">
        <div className="text-8xl mb-4">🕵️‍♂️</div>
        <div className="absolute -top-2 -right-2 bg-neo-yellow border-2 border-black px-2 py-1 font-black text-xs uppercase shadow-neo-hover">
          LIVE AGENTS
        </div>
      </div>
      
      <h2 className="text-4xl font-black text-black uppercase italic mb-4 tracking-tighter">
        SUMMONING TALENT
      </h2>
      
      <div className="bg-white border-4 border-black p-6 shadow-neo max-w-md w-full">
        <p className="font-bold text-black uppercase text-lg">
          {RECRUITER_MESSAGES[index]}<AnimatedEllipsis />
        </p>
      </div>

      {totalSourced > 0 && (
        <div className="mt-8 bg-neo-green border-4 border-black px-6 py-2 shadow-neo animate-bounce">
          <p className="font-black text-black uppercase tracking-widest">
            {totalSourced} CANDIDATES SECURED
          </p>
        </div>
      )}
      
      <p className="mt-6 font-bold text-black/60 uppercase text-xs">
        The swarm is scouring the internet. Sit tight.
      </p>
    </div>
  );
};

const CandidateSwiper = () => {
  const {
    currentCandidate,
    stats,
    loading,
    pitch,
    filteredCandidates,
    fetchNextCandidate,
    acceptCandidate,
    rejectCandidate,
    sourceMoreCandidates,
    fetchCandidatesByStatus
  } = useApp();

  const [showPitch, setShowPitch] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const [exitDirection, setExitDirection] = useState(null); // 'left' or 'right'
  const [expandedStatus, setExpandedStatus] = useState(null);

  useEffect(() => {
    // Initial fetch
    fetchNextCandidate();
  }, []);

  useEffect(() => {
    // Show pitch modal when pitch is generated
    if (pitch) {
      setShowPitch(true);
    }
  }, [pitch]);

  const handleAccept = async () => {
    if (!currentCandidate || loading) return;
    setExitDirection('right');
    // Allow animation to start before data fetch updates state
    setTimeout(async () => {
        try {
        await acceptCandidate(currentCandidate.candidate.id);
        } catch (error) {
        alert('Error accepting candidate: ' + error.message);
        }
    }, 200);
  };

  const handleReject = async () => {
    if (!currentCandidate || loading) return;
    setExitDirection('left');
    setTimeout(async () => {
        try {
        await rejectCandidate(currentCandidate.candidate.id);
        } catch (error) {
        alert('Error rejecting candidate: ' + error.message);
        }
    }, 200);
  };

  const handleSourceMore = async () => {
    setSourcing(true);
    try {
      const result = await sourceMoreCandidates();
      alert(result.message);
    } catch (error) {
      alert('Error sourcing candidates: ' + error.message);
    } finally {
      setSourcing(false);
    }
  };

  const handleNextAfterAccept = async () => {
    setShowPitch(false);
    await fetchNextCandidate();
  };

  const handleStatClick = async (status) => {
    // Toggle: if already expanded, collapse it
    if (expandedStatus === status) {
      setExpandedStatus(null);
      return;
    }

    // Don't expand 'total' (no status filter for it)
    if (status === 'total') {
      return;
    }

    // Fetch and expand
    await fetchCandidatesByStatus(status);
    setExpandedStatus(status);
  };

  const handleCandidateClick = (candidateId) => {
    // Close dropdown
    setExpandedStatus(null);
    console.log('Navigate to candidate:', candidateId);
  };

  // Keyboard shortcuts
  useKeyboardShortcuts(handleReject, handleAccept, loading || showPitch);

  if (loading && !currentCandidate) {
    return <RecruiterLoading totalSourced={stats.total} />;
  }

  if (!currentCandidate) {
    return (
      <div className="flex flex-col items-center justify-center p-4 space-y-8">
        <StatsPanel
          stats={stats}
          expandedStatus={expandedStatus}
          onStatClick={handleStatClick}
          candidates={filteredCandidates}
          onCandidateClick={handleCandidateClick}
        />
        <div className="bg-white border-4 border-black shadow-neo p-8 max-w-2xl w-full text-center">
          <h2 className="text-4xl font-black text-black mb-4 uppercase italic">OUT OF CANDIDATES!</h2>
          <p className="font-bold text-black mb-6 uppercase">You've exhausted the current batch. Need more fuel?</p>
          <button
            onClick={handleSourceMore}
            disabled={sourcing}
            className="w-full bg-neo-yellow text-black font-black text-2xl py-5 border-4 border-black shadow-neo hover:border-yellow-600 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:bg-gray-400 uppercase"
          >
            {sourcing ? 'SOURCING...' : '🔄 CALL THE AGENTS AGAIN'}
          </button>
        </div>
      </div>
    );
  }

  const variants = {
    initial: { scale: 0.8, opacity: 0, y: 50 },
    enter: { 
      scale: 1, 
      opacity: 1, 
      y: 0, 
      x: 0, 
      rotate: 0,
      transition: { type: 'spring', stiffness: 300, damping: 20 }
    },
    exit: (direction) => ({
      x: direction === 'left' ? -1000 : 1000,
      rotate: direction === 'left' ? -20 : 20,
      opacity: 0,
      transition: { duration: 0.4, ease: "easeIn" }
    })
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Stats Panel */}
      <div className="w-full flex justify-center">
        <StatsPanel
          stats={stats}
          expandedStatus={expandedStatus}
          onStatClick={handleStatClick}
          candidates={filteredCandidates}
          onCandidateClick={handleCandidateClick}
        />
      </div>

      {/* Source More Button */}
      {stats.pending < 5 && (
        <div className="flex justify-center">
          <button
            onClick={handleSourceMore}
            disabled={sourcing || loading}
            className="bg-neo-blue text-black font-black py-1.5 px-4 border-3 border-black shadow-neo hover:border-blue-700 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all disabled:bg-gray-400 uppercase text-[10px]"
          >
            {sourcing ? 'Sourcing...' : '⚡ Source 25 More'}
          </button>
        </div>
      )}

      {/* Candidate Card */}
      <AnimatePresence custom={exitDirection} mode="wait">
        <motion.div
          key={currentCandidate.candidate.id}
          custom={exitDirection}
          variants={variants}
          initial="initial"
          animate="enter"
          exit="exit"
          className="w-full"
        >
          <CandidateCard
            candidate={currentCandidate.candidate}
            match={currentCandidate.match}
          />
        </motion.div>
      </AnimatePresence>

      {/* Swipe Controls */}
      <div>
        <SwipeControls
          onReject={handleReject}
          onAccept={handleAccept}
          disabled={loading}
        />
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-md">
          <div className="bg-neo-yellow border-4 border-black p-10 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] text-center max-w-sm">
            <p className="font-black text-black uppercase tracking-widest text-2xl mb-2">
              Analyzing Fit<AnimatedEllipsis />
            </p>
            <p className="text-xs font-black uppercase text-black/60 tracking-tighter">Consulting AI Swarm Intelligence</p>
          </div>
        </div>
      )}

      {/* Pitch Modal */}
      <PitchModal
        pitch={pitch}
        isOpen={showPitch}
        onClose={() => setShowPitch(false)}
        onNext={handleNextAfterAccept}
      />
    </div>
  );
};

export default CandidateSwiper;
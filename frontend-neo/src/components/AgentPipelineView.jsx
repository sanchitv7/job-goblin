import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const AGENTS = [
  { key: 'sourcing', label: 'SOURCING', icon: '🔍', color: 'neo-yellow' },
  { key: 'matching', label: 'MATCHING', icon: '🎯', color: 'neo-blue' },
  { key: 'pitch_writer', label: 'PITCH WRITING', icon: '✍️', color: 'neo-pink' },
];

const StepIndicator = ({ status, color }) => {
  if (status === 'complete') {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="w-8 h-8 bg-neo-green border-2 border-black flex items-center justify-center font-black text-sm"
      >
        ✓
      </motion.div>
    );
  }
  if (status === 'active') {
    return (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
        className={`w-8 h-8 bg-${color} border-2 border-black flex items-center justify-center`}
      >
        <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full" />
      </motion.div>
    );
  }
  return (
    <div className="w-8 h-8 bg-gray-200 border-2 border-black flex items-center justify-center">
      <div className="w-2 h-2 bg-gray-400 rounded-full" />
    </div>
  );
};

const AgentPipelineView = ({ jobId, onComplete }) => {
  const [agentStates, setAgentStates] = useState({
    sourcing: 'pending',
    matching: 'pending',
    pitch_writer: 'pending',
  });
  const [messages, setMessages] = useState({});
  const [progress, setProgress] = useState({});
  const [pipelineStatus, setPipelineStatus] = useState('connecting'); // connecting | running | complete | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;

    const es = new EventSource(`${API_BASE_URL}/api/jobs/${jobId}/pipeline/events`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setPipelineStatus('running');
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'pipeline_start':
            setPipelineStatus('running');
            setTotalCandidates(data.total || 0);
            break;

          case 'agent_start':
            setAgentStates((prev) => ({ ...prev, [data.agent]: 'active' }));
            setMessages((prev) => ({ ...prev, [data.agent]: data.message }));
            break;

          case 'agent_progress':
            setMessages((prev) => ({ ...prev, [data.agent]: data.message }));
            setProgress((prev) => ({
              ...prev,
              [data.agent]: { count: data.count, total: data.total },
            }));
            break;

          case 'agent_complete':
            setAgentStates((prev) => ({ ...prev, [data.agent]: 'complete' }));
            setMessages((prev) => ({ ...prev, [data.agent]: data.message }));
            setProgress((prev) => ({
              ...prev,
              [data.agent]: { count: data.count, total: data.total },
            }));
            if (data.total) setTotalCandidates(data.total);
            break;

          case 'pipeline_complete':
            setPipelineStatus('complete');
            if (data.total) setTotalCandidates(data.total);
            es.close();
            setTimeout(() => onComplete?.(), 1500);
            break;

          case 'pipeline_error':
            setPipelineStatus('error');
            setErrorMessage(data.error || data.message);
            es.close();
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect for transient errors.
      // If the connection is closed permanently, readyState === 2.
      if (es.readyState === 2) {
        // Only show error if we never got a complete event
        if (pipelineStatus !== 'complete') {
          setPipelineStatus('error');
          setErrorMessage('Lost connection to pipeline. The agents may still be running.');
        }
      }
    };

    return () => {
      es.close();
    };
  }, [jobId]);

  const handleRetry = () => {
    setPipelineStatus('connecting');
    setErrorMessage(null);
    setAgentStates({ sourcing: 'pending', matching: 'pending', pitch_writer: 'pending' });
    setMessages({});
    setProgress({});
    // Re-trigger by toggling jobId effect — simplest: just reconnect
    const es = new EventSource(`${API_BASE_URL}/api/jobs/${jobId}/pipeline/events`);
    if (eventSourceRef.current) eventSourceRef.current.close();
    eventSourceRef.current = es;
    // Re-attach same handlers (via re-mount would be cleaner, but this works)
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <div className="mb-6 text-center">
        <h2 className="text-4xl font-black text-black uppercase italic tracking-tighter mb-2">
          AGENT PIPELINE
        </h2>
        <p className="text-xs font-black uppercase text-black/50 tracking-widest">
          {pipelineStatus === 'connecting' && 'CONNECTING TO AGENTS...'}
          {pipelineStatus === 'running' && 'AGENTS ARE WORKING'}
          {pipelineStatus === 'complete' && 'ALL AGENTS FINISHED'}
          {pipelineStatus === 'error' && 'PIPELINE ERROR'}
        </p>
      </div>

      <div className="bg-white border-4 border-black shadow-neo p-6 max-w-md w-full space-y-4">
        {AGENTS.map((agent, i) => {
          const status = agentStates[agent.key];
          const msg = messages[agent.key];
          const prog = progress[agent.key];

          return (
            <div key={agent.key}>
              <motion.div
                className={`flex items-center gap-4 p-3 border-2 border-black transition-colors ${
                  status === 'active'
                    ? `bg-${agent.color}`
                    : status === 'complete'
                    ? 'bg-neo-green/20'
                    : 'bg-gray-50'
                }`}
                animate={status === 'active' ? { scale: [1, 1.01, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <StepIndicator status={status} color={agent.color} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{agent.icon}</span>
                    <span className="font-black uppercase text-sm tracking-tight">
                      {agent.label}
                    </span>
                  </div>
                  <AnimatePresence mode="wait">
                    {msg && (
                      <motion.p
                        key={msg}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-xs font-bold text-black/60 truncate mt-1"
                      >
                        {msg}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  {prog && status === 'active' && (
                    <div className="mt-1 h-2 bg-gray-200 border border-black">
                      <motion.div
                        className={`h-full bg-${agent.color}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(prog.count / prog.total) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
              {i < AGENTS.length - 1 && (
                <div className="flex justify-center py-1">
                  <div className="w-0.5 h-4 bg-black" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Complete State */}
      <AnimatePresence>
        {pipelineStatus === 'complete' && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mt-6 bg-neo-green border-4 border-black px-8 py-4 shadow-neo text-center"
          >
            <p className="font-black text-black uppercase tracking-widest text-lg">
              READY TO REVIEW!
            </p>
            {totalCandidates > 0 && (
              <p className="font-bold text-black/70 uppercase text-sm mt-1">
                {totalCandidates} candidates sourced
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error State */}
      <AnimatePresence>
        {pipelineStatus === 'error' && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mt-6 bg-neo-pink border-4 border-black px-8 py-4 shadow-neo text-center max-w-md"
          >
            <p className="font-black text-black uppercase tracking-widest text-lg mb-2">
              PIPELINE ERROR
            </p>
            <p className="font-bold text-black/70 text-sm mb-4">{errorMessage}</p>
            <button
              onClick={handleRetry}
              className="bg-neo-yellow text-black font-black py-2 px-6 border-2 border-black shadow-neo hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all uppercase text-sm"
            >
              RETRY
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AgentPipelineView;

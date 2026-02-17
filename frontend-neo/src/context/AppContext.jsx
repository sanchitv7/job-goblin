import { createContext, useContext, useState } from 'react';
import axios from 'axios';

const AppContext = createContext();

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const AppProvider = ({ children }) => {
  const [jobId, setJobId] = useState(null);
  const [currentCandidate, setCurrentCandidate] = useState(null);
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    viewed: 0,
    accepted: 0,
    rejected: 0,
    contacted: 0
  });
  const [loading, setLoading] = useState(false);
  const [pitch, setPitch] = useState(null);
  const [filteredCandidates, setFilteredCandidates] = useState([]);

  const createJob = async (jobData) => {
    setLoading(true);
    setCurrentCandidate(null);
    setPitch(null);
    setStats({
      total: 0,
      pending: 0,
      viewed: 0,
      accepted: 0,
      rejected: 0,
      contacted: 0
    });
    
    try {
      const response = await axios.post(`${API_BASE_URL}/api/jobs`, jobData);
      setJobId(response.data.job_id);
      return response.data;
    } catch (error) {
      console.error('Error creating job:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchNextCandidate = async (isRetry = false) => {
    if (!jobId) return;

    if (!isRetry) setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/jobs/${jobId}/candidates`);
      
      if (response.data.stats) {
        setStats(response.data.stats);
      }

      if (response.data.candidate) {
        setCurrentCandidate(response.data);
        setLoading(false);
      } else if (response.data.stats && (response.data.stats.total === 0 || response.data.stats.pending > 0)) {
        // No candidate returned, but either:
        // 1. We haven't sourced any yet (total === 0)
        // 2. We have pending candidates but they might not be matched yet (pending > 0)
        // Poll every 3 seconds
        setTimeout(() => fetchNextCandidate(true), 3000);
      } else {
        setCurrentCandidate(null);
        setLoading(false);
      }
      setPitch(null); // Reset pitch when loading new candidate
    } catch (error) {
      console.error('Error fetching candidate:', error);
      setLoading(false);
    }
  };

  const acceptCandidate = async (candidateId) => {
    setLoading(true);
    try {
      const response = await axios.put(`${API_BASE_URL}/api/candidates/${candidateId}/accept`);
      // response.data.pitch now includes just the content, we need to attach the ID
      setPitch({
        ...response.data.pitch,
        outreachId: response.data.outreach_id
      });
      // Update stats
      await fetchStats();
      return response.data;
    } catch (error) {
      console.error('Error accepting candidate:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const sendOutreach = async (outreachId, subject, body) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/outreach/send`, {
        outreach_id: outreachId,
        subject,
        body
      });
      return response.data;
    } catch (error) {
      console.error('Error sending outreach:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const rejectCandidate = async (candidateId) => {
    setLoading(true);
    try {
      const response = await axios.put(`${API_BASE_URL}/api/candidates/${candidateId}/reject`);
      if (response.data.next_candidate) {
        setCurrentCandidate(response.data.next_candidate);
      } else {
        setCurrentCandidate(null);
      }
      // Update stats
      await fetchStats();
    } catch (error) {
      console.error('Error rejecting candidate:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const sourceMoreCandidates = async () => {
    if (!jobId) return;

    setLoading(true);
    setCurrentCandidate(null);
    try {
      await axios.post(`${API_BASE_URL}/api/jobs/${jobId}/source-more`);
      return { message: 'Sourcing new candidates... Watch the pipeline view for progress.' };
    } catch (error) {
      console.error('Error sourcing more candidates:', error);
      setLoading(false);
      throw error;
    }
  };

  const fetchStats = async () => {
    if (!jobId) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/api/jobs/${jobId}/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchCandidatesByStatus = async (status) => {
    if (!jobId) return [];

    try {
      const response = await axios.get(`${API_BASE_URL}/api/jobs/${jobId}/candidates/by-status/${status}`);
      setFilteredCandidates(response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching candidates by status:', error);
      return [];
    }
  };

  return (
    <AppContext.Provider
      value={{
        jobId,
        currentCandidate,
        stats,
        loading,
        pitch,
        filteredCandidates,
        createJob,
        fetchNextCandidate,
        acceptCandidate,
        rejectCandidate,
        sourceMoreCandidates,
        fetchStats,
        sendOutreach,
        fetchCandidatesByStatus
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

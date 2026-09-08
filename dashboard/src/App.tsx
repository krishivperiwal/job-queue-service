import { useEffect, useState } from 'react';
import './App.css';

const API_BASE = 'http://localhost:3000';

interface Job {
  id: string;
  job_type: string;
  payload: {
    source_url?: string;
  };
  status: string;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  created_at: string;
}

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [sourceUrl, setSourceUrl] = useState('https://example.com/cat.jpg');
  const [sizes, setSizes] = useState('128,256');
  const [submitting, setSubmitting] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState<string | null>(null);
  const [expandedUrlJobId, setExpandedUrlJobId] = useState<string | null>(null);

async function fetchJobs() {
  try {
    const res = await fetch(`${API_BASE}/jobs`);
    const data = await res.json();
    if (Array.isArray(data)) {
      setJobs(data);
    } else {
      console.error('GET /jobs did not return an array:', data);
    }
  } catch (err) {
    console.error('Failed to fetch jobs:', err);
  }
}

  async function fetchQueueDepth() {
    try {
      const res = await fetch(`${API_BASE}/queue-depth`);
      const data = await res.json();
      setQueueDepth(data.pending);
    } catch {
      setQueueDepth(null);
    }
  }

  useEffect(() => {
    fetchJobs();
    fetchQueueDepth();
    const interval = setInterval(() => {
      fetchJobs();
      fetchQueueDepth();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

 async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSubmitting(true);
  try {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_type: 'image_thumbnail',
        payload: {
          source_url: sourceUrl,
          sizes: sizes.split(',').map((s) => parseInt(s.trim(), 10)),
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      console.error('Job submission failed:', err);
    }
    await fetchJobs();
  } catch (err) {
    console.error('Network or CORS error:', err);
  } finally {
    setSubmitting(false);
  }
}

  async function handleReplay(id: string) {
    await fetch(`${API_BASE}/jobs/${id}/replay`, { method: 'POST' });
    fetchJobs();
  }

  async function handleDelete(id: string) {
    await fetch(`${API_BASE}/jobs/${id}`, { method: 'DELETE' });
    await fetchJobs();
    fetchQueueDepth();
  }

  function statusClass(status: string) {
    return `status-badge status-${status}`;
  }

  async function copyJobId(id: string) {
    await navigator.clipboard.writeText(id);
    setCopiedJobId(id);
    setTimeout(() => {
      setCopiedJobId((currentId) => (currentId === id ? null : currentId));
    }, 1500);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Job Queue Dashboard</h1>
          <p className="subtitle">Monitor asynchronous image processing jobs.</p>
        </div>
        <div className="queue-stat">
          <span className="stat-label">Pending in queue</span>
          <strong>{queueDepth ?? '—'}</strong>
        </div>
      </header>

      <section className="submit-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">New job</p>
            <h2>Submit image thumbnail</h2>
          </div>
          <span className="job-type">image_thumbnail</span>
        </div>
        <form onSubmit={handleSubmit} className="job-form">
          <label>
            Source URL
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </label>
          <label>
            Sizes
            <input value={sizes} onChange={(e) => setSizes(e.target.value)} />
            <span className="field-hint">Comma-separated pixel sizes</span>
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit job'}
          </button>
        </form>
      </section>

      <section className="jobs-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h2>Recent jobs</h2>
          </div>
          <span className="refresh-note">Auto-refreshes every 3 seconds</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Source URL</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Error</th>
                <th>Created</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="job-id" title={job.id}>
                    <button className="copy-id-button" onClick={() => copyJobId(job.id)}>
                      {job.id}
                    </button>
                    {copiedJobId === job.id && <span className="copied-label">Copied</span>}
                  </td>
                  <td className="source-url-cell">
                    <button
                      className={`source-url-button${expandedUrlJobId === job.id ? ' expanded' : ''}`}
                      title={job.payload.source_url ?? 'Source URL unavailable'}
                      onClick={() => setExpandedUrlJobId((currentId) => currentId === job.id ? null : job.id)}
                    >
                      {job.payload.source_url ?? '—'}
                    </button>
                  </td>
                  <td><span className={statusClass(job.status)}>{job.status}</span></td>
                  <td className="attempts">{job.attempts}/{job.max_attempts}</td>
                  <td className="error-cell">{job.error_message ?? '—'}</td>
                  <td>{new Date(job.created_at).toLocaleTimeString()}</td>
                  <td className="action-cell">
                    <div className="action-buttons">
                      {job.status === 'failed' && (
                        <button className="replay-button" onClick={() => handleReplay(job.id)}>Replay</button>
                      )}
                      {job.status !== 'processing' && (
                        <button className="delete-button" onClick={() => handleDelete(job.id)}>Remove</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
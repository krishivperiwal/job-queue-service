import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:3000';

interface Job {
  id: string;
  job_type: string;
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

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Job Queue Dashboard</h1>
      <p>Pending in queue: {queueDepth ?? '—'}</p>

      <form onSubmit={handleSubmit} style={{ marginBottom: 32 }}>
        <div>
          <label>Source URL: </label>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} style={{ width: 300 }} />
        </div>
        <div>
          <label>Sizes (comma-separated): </label>
          <input value={sizes} onChange={(e) => setSizes(e.target.value)} />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Job'}
        </button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>ID</th>
            <th style={{ textAlign: 'left' }}>Status</th>
            <th style={{ textAlign: 'left' }}>Attempts</th>
            <th style={{ textAlign: 'left' }}>Error</th>
            <th style={{ textAlign: 'left' }}>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} style={{ borderTop: '1px solid #ccc' }}>
              <td>{job.id.slice(0, 8)}...</td>
              <td>{job.status}</td>
              <td>{job.attempts}/{job.max_attempts}</td>
              <td>{job.error_message ?? '—'}</td>
              <td>{new Date(job.created_at).toLocaleTimeString()}</td>
              <td>
                {job.status === 'failed' && (
                  <button onClick={() => handleReplay(job.id)}>Replay</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
import React, { useState, useEffect, useRef, useMemo } from 'react';
// Simple LoginView component for authentication
function LoginView({ onLoginSuccess }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = () => {
    setError('');
    setIsLoading(true);
    setTimeout(() => {
      if (!userId || !password) {
        setError('Please enter both email and password.');
        setIsLoading(false);
        return;
      }
      if (!/^[^@]+@gmail\.com$/.test(userId)) {
        setError('Only Gmail addresses are allowed.');
        setIsLoading(false);
        return;
      }
      if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
        setError('Password must contain a capital letter and a number.');
        setIsLoading(false);
        return;
      }
      localStorage.setItem('voiceAuthUser', JSON.stringify({ userId, timestamp: Date.now(), authMethod: 'password' }));
      onLoginSuccess({ userId });
      setIsLoading(false);
    }, 800);
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Voice Authentication</h1>
          <p>Secure biometric login</p>
        </div>
        <div className="auth-form">
          <div className="form-group">
            <label htmlFor="userId">Gmail Address</label>
            <input
              id="userId"
              type="email"
              placeholder="Enter your Gmail (e.g., user@gmail.com)"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setError('');
              }}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Password (e.g., Abc123)"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
            />
            <small style={{ color: '#888', marginTop: '4px', display: 'block' }}>
              Must contain: 1 capital letter + numbers
            </small>
          </div>
          {error && <div className="form-error">{error}</div>}
          <button
            className="auth-submit"
            onClick={handleLogin}
            disabled={isLoading}
            style={{ marginTop: 16 }}
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </div>
        <div className="auth-footer">
          <p>Standard login requires Gmail address + password with capital letter & numbers</p>
        </div>
      </div>
    </div>
  );
}

// ...existing code...
// --- Audio helpers (inlined from backup) ---
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hashBytes(bytes) {
  let hash = 5381;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) + hash) + bytes[i];
  }
  return hash >>> 0;
}

async function blobToAudioBuffer(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioContext.close();
  }
}

function analyzeAudioBuffer(buffer) {
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  let sumSquares = 0;
  let zeroCrossings = 0;
  let peak = 0;

  for (let index = 0; index < length; index += 1) {
    const value = channel[index];
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (index > 0 && (value >= 0) !== (channel[index - 1] >= 0)) {
      zeroCrossings += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, length));
  const zcr = zeroCrossings / Math.max(1, length / buffer.sampleRate);
  const loudness = clamp(Math.round(rms * 180), 5, 100);
  const clarity = clamp(Math.round((1 - Math.abs(zcr - 120) / 180) * 100), 20, 99);
  const stability = clamp(Math.round((1 - Math.abs(peak - 0.6)) * 120), 35, 99);

  return {
    loudness,
    clarity,
    stability,
    duration: buffer.duration,
    rms,
    zcr,
    peak,
  };
}

function scoreAudio(buffer, mode) {
  const metrics = analyzeAudioBuffer(buffer);
  const sampleWindow = buffer.length > 65536 ? 65536 : buffer.length;
  const seed = hashBytes(new Uint8Array(sampleWindow));
  const embeddingScore = clamp(Math.round((metrics.loudness + metrics.clarity + metrics.stability) / 3), 0, 100);
  const spoofScore = clamp(Math.round(100 - (metrics.zcr % 40) - metrics.peak * 15), 12, 99);
  const voiceSimilarity = clamp(Math.round(embeddingScore * 0.72 + (seed % 19) + (mode === 'enroll' ? 4 : -3)), 0, 100);
  const antiSpoofConfidence = clamp(Math.round((spoofScore + metrics.stability) / 2), 0, 100);

  return {
    metrics,
    embeddingScore,
    spoofScore,
    voiceSimilarity,
    antiSpoofConfidence,
  };
}

// Wake word/trigger phrase list
const WAKE_WORDS = [
  'unlock all',
  'open system',
  'hello assistant',
  'activate mode',
];

function VoiceAuthView({ user, onLogout }) {
  // All state, refs, and handlers must be defined here for use in renderFeature
  const shellRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const startedAtRef = useRef(0);

  const [mode, setMode] = useState('enroll');
  const [status, setStatus] = useState('Ready to capture voice');
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [enrolledProfile, setEnrolledProfile] = useState(null);
  const [analysis, setAnalysis] = useState({
    embeddingScore: 0,
    spoofScore: 0,
    voiceSimilarity: 0,
    antiSpoofConfidence: 0,
    metrics: { loudness: 0, clarity: 0, stability: 0, duration: 0 },
  });
  const [decision, setDecision] = useState('Awaiting audio sample');
  const [waveform, setWaveform] = useState(Array.from({ length: 24 }, (_, index) => 20 + (index % 4) * 12));

  const [selectedFeature, setSelectedFeature] = useState(0); // 0: Secure login, 1: Live capture, etc.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (recordedUrl) {
        URL.revokeObjectURL(recordedUrl);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [recordedUrl]);

  useEffect(() => {
    if (!isRecording) {
      return undefined;
    }
    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const bars = Array.from({ length: 24 }, (_, index) => {
        const phase = elapsed * 2 + index * 0.45;
        const raw = 34 + Math.abs(Math.sin(phase) * 44) + Math.abs(Math.cos(phase * 0.6) * 12);
        return clamp(Math.round(raw), 10, 98);
      });
      setWaveform(bars);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [isRecording]);

  const enrollmentStats = useMemo(() => {
    if (!enrolledProfile) {
      return null;
    }
    return [
      { label: 'Template similarity', value: `${enrolledProfile.voiceSimilarity}%` },
      { label: 'Anti-spoof confidence', value: `${enrolledProfile.antiSpoofConfidence}%` },
      { label: 'Profile duration', value: `${enrolledProfile.metrics.duration.toFixed(1)}s` },
    ];
  }, [enrolledProfile]);

  // Helper: Use browser SpeechRecognition API for wake word detection
  function detectWakeWordFromAudio(blob) {
    return new Promise((resolve) => {
      // Try to use SpeechRecognition API if available
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        // Fallback: always allow (for browsers without API)
        resolve({ found: false, transcript: '' });
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      // Create a temporary audio element to play the blob for recognition
      const audioURL = URL.createObjectURL(blob);
      const audio = new Audio(audioURL);
      let resolved = false;
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase();
        const found = WAKE_WORDS.some((phrase) => transcript.includes(phrase));
        resolved = true;
        resolve({ found, transcript });
        URL.revokeObjectURL(audioURL);
      };
      recognition.onerror = () => {
        if (!resolved) resolve({ found: false, transcript: '' });
        URL.revokeObjectURL(audioURL);
      };
      // Play audio and start recognition
      audio.onplay = () => recognition.start();
      audio.onended = () => recognition.stop();
      audio.play();
      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          recognition.stop();
          resolve({ found: false, transcript: '' });
          URL.revokeObjectURL(audioURL);
        }
      }, 6000);
    });
  }

  async function startCapture() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Microphone access is unavailable in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setIsRecording(true);
      setStatus('Listening for your passphrase');
      setDecision('Recording in progress');
      setAudioDuration(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        // Wake word detection first
        setStatus('Detecting wake word...');
        const wakeResult = await detectWakeWordFromAudio(audioBlob);
        if (!wakeResult.found) {
          setDecision('Wake word not detected. Try again.');
          setStatus('No valid trigger phrase found.');
          setIsRecording(false);
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          recorderRef.current = null;
          return;
        }
        // Proceed to speaker recognition
        setStatus('Wake word detected. Analyzing speaker...');
        const nextUrl = URL.createObjectURL(audioBlob);
        const buffer = await blobToAudioBuffer(audioBlob);
        const nextAnalysis = scoreAudio(buffer, mode);
        const nextDuration = buffer.duration;
        const isSpoofed = nextAnalysis.antiSpoofConfidence < 58 || nextAnalysis.spoofScore < 55;
        const templateMatch = enrolledProfile
          ? Math.round(enrolledProfile.voiceSimilarity * 0.55 + nextAnalysis.voiceSimilarity * 0.45)
          : nextAnalysis.voiceSimilarity;
        const accepted = !isSpoofed && templateMatch >= 72;
        if (recordedUrl) {
          URL.revokeObjectURL(recordedUrl);
        }
        setRecordedUrl(nextUrl);
        setAudioDuration(nextDuration);
        setAnalysis(nextAnalysis);
        setDecision(accepted ? 'Access granted' : 'Access denied');
        setStatus(accepted ? 'Verified as the enrolled speaker' : isSpoofed ? 'Possible spoof detected' : 'Speaker mismatch detected');
        if (mode === 'enroll') {
          setEnrolledProfile(nextAnalysis);
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
      };
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, mode === 'enroll' ? 4500 : 3500);
    } catch (error) {
      setStatus('Microphone permission denied or unavailable');
      setDecision(error instanceof Error ? error.message : 'Unable to access microphone');
      setIsRecording(false);
    }
  }

  function stopCapture() {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  function syncPointer(event) {
    if (!shellRef.current) {
      return;
    }
    const bounds = shellRef.current.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerY = ((event.clientY - bounds.top) / bounds.height) * 100;
    shellRef.current.style.setProperty('--pointer-x', `${clamp(pointerX, 0, 100)}%`);
    shellRef.current.style.setProperty('--pointer-y', `${clamp(pointerY, 0, 100)}%`);
  }

  function clearPointer() {
    if (!shellRef.current) {
      return;
    }
    shellRef.current.style.setProperty('--pointer-x', '50%');
    shellRef.current.style.setProperty('--pointer-y', '18%');
  }

  // Sidebar menu items
  const menuItems = [
    {
      icon: (
        <svg className="menu-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 1C6.48 1 2 5.48 2 11s4.48 10 10 10 10-4.48 10-10S17.52 1 12 1zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 7 15.5 7 14 7.67 14 8.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 7 8.5 7 7 7.67 7 8.5 7.67 10 8.5 10zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
        </svg>
      ),
      title: 'Secure login',
      subtitle: 'Voiceprint verification with anti-spoofing defense',
    },
    {
      icon: (
        <svg className="menu-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="1"></circle>
          <path d="M12 21v2M21 12h2"></path>
          <path d="M4.22 4.22l1.41 1.41"></path>
          <path d="M1 12h2"></path>
          <path d="M4.22 19.78l1.41-1.41"></path>
          <path d="M12 1v2"></path>
          <path d="M20.485 3.515l-1.414 1.414"></path>
          <path d="M19.778 19.778l-1.414-1.414"></path>
          <path d="M3.515 3.515l1.414 1.414"></path>
        </svg>
      ),
      title: 'Live capture',
      subtitle: 'Real-time audio analysis',
    },
    {
      icon: (
        <svg className="menu-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 17"></polyline>
          <polyline points="17 6 23 6 23 12"></polyline>
        </svg>
      ),
      title: 'Auth metrics',
      subtitle: 'Embedding quality & anti-spoof scores',
    },
    {
      icon: (
        <svg className="menu-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      ),
      title: 'Enrollment profile',
      subtitle: 'Manage your voiceprint template',
    },
    {
      icon: (
        <svg className="menu-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
          <path d="M16 3a2 2 0 0 1 2 2"></path>
          <path d="M6 3a2 2 0 0 0-2 2"></path>
        </svg>
      ),
      title: 'Banking use case',
      subtitle: 'Voice-authenticated transactions',
    },
  ];

  // ...existing code for state, refs, handlers...

  // Render only the selected feature
  function renderFeature() {
    switch (selectedFeature) {
      case 0:
        return (
          <section className="hero card">
            <div className="hero-surface" aria-hidden="true">
              <span className="surface-orb surface-orb-a" />
              <span className="surface-orb surface-orb-b" />
              <span className="surface-ripple" />
              <div className="ambient-particles">
                {ambientParticles.map((particle) => (
                  <span
                    key={particle.id}
                    className={`ambient-particle tint-${particle.tint}`}
                    style={{
                      '--particle-size': `${particle.size}px`,
                      '--particle-x': `${(particle.x + 9) % 100}%`,
                      '--particle-y': `${(particle.y + 11) % 100}%`,
                      '--particle-delay': `${particle.delay}s`,
                      '--particle-duration': `${particle.duration + 2}s`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="hero-copy">
              <p className="eyebrow">Deep-learning voice authentication</p>
              <h1>Secure login with voiceprint verification and anti-spoofing defense.</h1>
              <p className="lede">
                This demo captures speech in the browser, simulates a speaker embedding pipeline,
                and combines it with a spoof check before granting access.
              </p>
              <div className="hero-actions">
                <button className="primary" onClick={startCapture} disabled={isRecording}>
                  {isRecording ? 'Recording...' : mode === 'enroll' ? 'Enroll voice' : 'Verify voice'}
                </button>
                <button className="secondary" onClick={stopCapture} disabled={!isRecording}>
                  Stop capture
                </button>
              </div>
              <div className="mode-switch" role="tablist" aria-label="Authentication mode">
                <button className={mode === 'enroll' ? 'mode active' : 'mode'} onClick={() => setMode('enroll')}>
                  Enrollment
                </button>
                <button className={mode === 'login' ? 'mode active' : 'mode'} onClick={() => setMode('login')}>
                  Login
                </button>
              </div>
            </div>
            <div className="status-panel">
              <div className="status-ring">
                <div className="status-ring-inner">
                  <span>{enrolledProfile ? analysis.voiceSimilarity : analysis.embeddingScore}%</span>
                  <small>{mode === 'enroll' ? 'voiceprint strength' : 'match confidence'}</small>
                </div>
              </div>
              <div className="status-copy">
                <p className="status-label">Current status</p>
                <p className="status-value">{status}</p>
                <p className="status-note">{decision}</p>
              </div>
            </div>
          </section>
        );
      case 1:
        return (
          <section className="grid two-up">
            <article className="card capture-card">
              <div className="card-header">
                <h2>Live capture</h2>
                <span>{formatTime(audioDuration)}</span>
              </div>
              <div className="waveform" aria-hidden="true">
                {waveform.map((bar, index) => (
                  <span key={index} style={{ height: `${bar}%` }} />
                ))}
              </div>
              <p className="caption">
                Speak a passphrase clearly. The microphone stream is preprocessed, analyzed, and scored in real time.
              </p>
            </article>
          </section>
        );
      case 2:
        return (
          <section className="grid two-up">
            <article className="card metrics-card">
              <div className="card-header">
                <h2>Authentication metrics</h2>
                <span>On-device pipeline</span>
              </div>
              <div className="metric-grid">
                <div className="metric">
                  <strong>{analysis.embeddingScore}%</strong>
                  <span>Embedding quality</span>
                </div>
                <div className="metric">
                  <strong>{analysis.voiceSimilarity}%</strong>
                  <span>Speaker similarity</span>
                </div>
                <div className="metric">
                  <strong>{analysis.antiSpoofConfidence}%</strong>
                  <span>Anti-spoof confidence</span>
                </div>
                <div className="metric">
                  <strong>{analysis.spoofScore}%</strong>
                  <span>Live speech score</span>
                </div>
              </div>
              <div className="feature-list">
                {featureLabels.map((label, index) => (
                  <div key={label} className="feature-item">
                    <span>{index + 1}</span>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        );
      case 3:
        return (
          <section className="grid bottom-grid">
            <article className="card data-card">
              <div className="card-header">
                <h2>Enrollment profile</h2>
                <span>{enrolledProfile ? 'Stored voiceprint ready' : 'No enrolled speaker yet'}</span>
              </div>
              {enrolledProfile ? (
                <div className="profile-details">
                  {enrollmentStats?.map((item) => (
                    <div key={item.label} className="profile-row">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  Capture an enrollment sample first. The app will store a template voiceprint for later login checks.
                </p>
              )}
            </article>
          </section>
        );
      case 4:
        return (
          <section className="grid bottom-grid">
            <article className="card usecase-card">
              <div className="card-header">
                <h2>Banking use case</h2>
                <span>Voice as a biometric factor</span>
              </div>
              <p>
                A customer speaks a passphrase to unlock account access. The system verifies both speaker identity
                and speech liveness before permitting a sensitive action such as viewing balances or confirming a transfer.
              </p>
              <div className="score-bars">
                {sampleScores.map((score, index) => (
                  <div key={score} className="score-row">
                    <span>Model {index + 1}</span>
                    <div className="score-track">
                      <div style={{ width: `${score}%` }} />
                    </div>
                    <strong>{score}%</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        );
      default:
        return null;
    }
  }

  return (
    <div className="app-wrapper">
      <div className="app-navbar">
        <div className="navbar-content">
          <h2>{user.userId}</h2>
          <div className="navbar-right">
            <button className="logout-btn" onClick={onLogout}>Logout</button>
            <div className="profile-icon-container">
              <button
                className={`profile-icon ${rightPanelOpen ? 'active' : ''}`}
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                title="Open menu"
              >
                {user.userId?.charAt(0).toUpperCase() || 'U'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <main className="shell">
        {rightPanelOpen && <div className="sidebar-backdrop" onClick={() => setRightPanelOpen(false)} />}
        <div className={`premium-sidebar ${rightPanelOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <button className="sidebar-close" onClick={() => setRightPanelOpen(false)}>×</button>
          </div>
          <div className="sidebar-menu">
            {menuItems.map((item, idx) => (
              <div
                key={item.title}
                className={`menu-item${selectedFeature === idx ? ' selected' : ''}`}
                onClick={() => {
                  setSelectedFeature(idx);
                  setRightPanelOpen(false);
                }}
                style={{ cursor: 'pointer' }}
              >
                {item.icon}
                <div>
                  <div className="menu-title">{item.title}</div>
                  <div className="menu-subtitle">{item.subtitle}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {renderFeature()}
        {recordedUrl && selectedFeature === 0 && (
          <section className="card audio-card">
            <div className="card-header">
              <h2>Captured sample</h2>
              <span>Review the recorded clip</span>
            </div>
            <audio controls src={recordedUrl} />
          </section>
        )}
      </main>
    </div>
  );
}

// Enrollment phrases (<=10 words)
const ENROLLMENT_PHRASES = [
  'Open the secure system now',
  'My voice is my password',
  'Unlock all features for me',
  'Hello assistant, please activate mode',
  'Voice authentication is secure and easy',
  'Let me access my account',
  'Enable advanced protection today',
  'This is my unique voiceprint',
  'Start the verification process now',
  'I trust this system for login',
];

function EnrollmentView({ user, onComplete }) {
      async function startEnrollmentCapture() {
        setStatus('Recording...');
        setIsRecording(true);
        setRetry(false);
        setLastTriedPhrase(currentPhrase);
        try {
          // Prompt user to speak the phrase live for recognition
          let phraseMatched = false;
          let transcript = '';
          if (window.SpeechRecognition || window.webkitSpeechRecognition) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.continuous = false;
            recognition.interimResults = false;
            setStatus('Please speak the displayed phrase now...');
            await new Promise((resolve) => {
              recognition.onresult = (event) => {
                transcript = event.results[0][0].transcript.trim().toLowerCase();
                // Remove punctuation for comparison
                const clean = (str) => str.replace(/[^a-z0-9 ]/gi, '').toLowerCase();
                const spoken = clean(transcript);
                const expected = clean(currentPhrase);
                // Allow partial match if 80% of words match
                const spokenWords = spoken.split(' ');
                const expectedWords = expected.split(' ');
                let matchCount = 0;
                expectedWords.forEach(word => {
                  if (spokenWords.includes(word)) matchCount++;
                });
                const wordMatch = matchCount / expectedWords.length >= 0.8;
                phraseMatched = (spoken === expected) || wordMatch;
                resolve();
              };
              recognition.onerror = () => resolve();
              recognition.onend = () => resolve();
              recognition.start();
              setTimeout(() => {
                recognition.stop();
                resolve();
              }, 4000);
            });
          } else {
            phraseMatched = false;
          }
          if (!phraseMatched) {
            setStatus('Please speak the displayed phrase exactly as shown.');
            setRetry(true);
            setIsRecording(false);
            return;
          }
          // If phrase matched, now record audio for scoring
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            streamRef.current = stream;
            recorderRef.current = recorder;
            let stopped = false;
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                chunksRef.current.push(event.data);
              }
            };
            recorder.onerror = (e) => {
              setStatus('Recording error. Please try again.');
              setIsRecording(false);
              try { stream.getTracks().forEach((track) => track.stop()); } catch {}
              streamRef.current = null;
              recorderRef.current = null;
              stopped = true;
            };
            recorder.onstop = async () => {
              if (stopped) return;
              stopped = true;
              try {
                const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const buffer = await blobToAudioBuffer(audioBlob);
                const result = scoreAudio(buffer, 'enroll');
                setAnalysis(result);
                if (result.embeddingScore >= MIN_EMBEDDING && result.antiSpoofConfidence >= MIN_ANTISPOOF) {
                  setStatus('');
                  setIsRecording(false);
                  setRetry(false);
                  setTimeout(() => {
                    let nextPhrase;
                    do {
                      nextPhrase = ENROLLMENT_PHRASES[Math.floor(Math.random() * ENROLLMENT_PHRASES.length)];
                    } while (nextPhrase === currentPhrase);
                    setSamples((prev) => [...prev, { analysis: result, phrase: currentPhrase }]);
                    setCurrentPhrase(nextPhrase);
                  }, 0);
                } else {
                  setStatus('Sample too weak or spoofed. Please try again.');
                  setRetry(true);
                  setIsRecording(false);
                }
              } catch (err) {
                setStatus('Audio processing error. Please try again.');
                setIsRecording(false);
              }
              try { stream.getTracks().forEach((track) => track.stop()); } catch {}
              streamRef.current = null;
              recorderRef.current = null;
            };
            recorder.start();
            setTimeout(() => {
              if (!stopped && recorder.state === 'recording') {
                recorder.stop();
              }
            }, 2000); // Shorter recording, since phrase already spoken
          } catch (e) {
            setStatus('Microphone error.');
            setIsRecording(false);
          }
        } catch (e) {
          setStatus('Microphone error.');
          setIsRecording(false);
        }
      }
    function finishEnrollment() {
      if (samples.length >= 5) {
        // Save profile and call onComplete
        const profile = {
          samples,
          created: Date.now(),
          userId: user.userId,
        };
        localStorage.setItem('voiceAuthProfile', JSON.stringify(profile));
        onComplete(profile);
      } else {
        setStatus('Please record at least 5 samples.');
      }
    }
  const [samples, setSamples] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Please record 5 voice samples. Read the phrase shown.');
  const [analysis, setAnalysis] = useState(null);
  // Remove recordedUrl, no audio playback needed
  const [currentPhrase, setCurrentPhrase] = useState(ENROLLMENT_PHRASES[Math.floor(Math.random() * ENROLLMENT_PHRASES.length)]);
  const [retry, setRetry] = useState(false);
  const [lastTriedPhrase, setLastTriedPhrase] = useState(null);
  const chunksRef = useRef([]);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);

  // Lowered quality thresholds for easier enrollment
  const MIN_EMBEDDING = 20;
  const MIN_ANTISPOOF = 30;

  // ...existing code...

  return (
    <>
      <div style={{ margin: '24px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#fff', marginBottom: 8 }}>Please read this phrase aloud:</div>
        <div style={{ fontSize: 22, color: '#7fd', fontWeight: 600, background: '#181a22', borderRadius: 8, padding: 12, display: 'inline-block', marginBottom: 16 }}>
          {retry ? lastTriedPhrase : currentPhrase}
        </div>
      </div>
      <button className="primary" onClick={startEnrollmentCapture} disabled={isRecording || samples.length >= 5} style={{ width: 180, fontSize: 16, marginTop: 8 }}>
        {isRecording ? 'Recording...' : retry ? 'Retry Sample' : 'Record Sample'}
      </button>
      <button className="secondary" onClick={finishEnrollment} disabled={isRecording || samples.length < 5} style={{ marginLeft: 12, width: 180, fontSize: 16, marginTop: 8 }}>
        Finish Enrollment
      </button>
      <div style={{ marginTop: 24 }}>
        <h4 style={{ color: '#7fd', fontWeight: 500 }}>Samples ({samples.length}/5)</h4>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {samples.map((s, i) => (
            <li key={i} style={{ marginBottom: 12, background: '#181a22', borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 15, color: '#7fd', marginBottom: 4 }}>{s.phrase}</div>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ marginTop: 24, color: '#f55', minHeight: 32, textAlign: 'center' }}>{status}</div>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [enrollmentDone, setEnrollmentDone] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('voiceAuthUser');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('voiceAuthUser');
      }
    }
    const storedProfile = localStorage.getItem('voiceAuthProfile');
    if (storedProfile) {
      setProfile(JSON.parse(storedProfile));
      setEnrollmentDone(true);
    }
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };


  const handleEnrollmentComplete = (profile) => {
    setProfile(profile);
    setEnrollmentDone(true);
  };

  if (!user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }
  if (!enrollmentDone) {
    return <EnrollmentView user={user} onComplete={handleEnrollmentComplete} />;
  }
  return <VoiceAuthView user={user} onLogout={() => {
    localStorage.removeItem('voiceAuthUser');
    localStorage.removeItem('voiceAuthProfile');
    setUser(null);
    setProfile(null);
    setEnrollmentDone(false);
  }} />;
}
